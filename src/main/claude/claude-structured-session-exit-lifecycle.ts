import { settledClaudeTurnEndLeaf } from './claude-structured-resume-point'
import type { ClaudeReleasedChildCleanup } from './claude-released-child-cleanup'
import {
  claudeRootExitObserved,
  settleClaudeExitedSession
} from './claude-structured-session-close'
import { failClaudeStartupGate } from './claude-structured-session-startup-gate'
import type {
  ClaudeAcquisitionAttempt,
  ClaudeSession,
  ClaudeSessionExit,
  ClaudeStructuredSessionAdapterDeps,
  ClaudeStructuredSessionEvent
} from './claude-structured-session-state'

export type ClaudeExitLifecycle = {
  sessions: Map<string, ClaudeSession>
  exits: Map<string, ClaudeSessionExit>
  /** A settled exit's diagnostic, kept for a send admitted before the host heard of the exit. */
  settledExitErrors: Map<string, Error>
  /** Re-checks an exit whose close saw a descendant alive, so its `ended` is never withheld for good. */
  cleanup: ClaudeReleasedChildCleanup
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'persistHandle' | 'now'>
  emit: (session: ClaudeSession, event: ClaudeStructuredSessionEvent) => void
}

export function observeClaudeSessionExit(
  lifecycle: ClaudeExitLifecycle,
  sessionId: string,
  attempt: ClaudeAcquisitionAttempt,
  error: Error
): void {
  const session = lifecycle.sessions.get(sessionId)
  if (!session || session.connection !== attempt.connection) {
    return
  }
  lifecycle.sessions.delete(sessionId)
  failClaudeStartupGate(session, error)
  // Re-enter the provider's close ladder before publishing lifecycle recovery:
  // an exit callback is root evidence only.
  const closePromise = session.connection.close().catch(() => false)
  const exit: ClaudeSessionExit = {
    connection: session.connection,
    session,
    error,
    closePromise
  }
  lifecycle.exits.set(sessionId, exit)
  exit.publication = closePromise
    .then((proven) => {
      if (proven) {
        return settleClaudeUnexpectedExit(lifecycle, sessionId, exit)
      }
      // The lease follows the root, so a first-hand root exit publishes `ended` even while the
      // tree is unverifiable. A descendant seen alive only defers it: the bounded cleanup re-runs
      // the ladder and publishes on proof, or at give-up with the last verdict reported.
      if (claudeRootExitObserved(session.connection)) {
        exit.ended = 'published'
        return settleClaudeUnexpectedExit(lifecycle, sessionId, exit)
      }
      const verdict = session.connection.exitVerdict
      if (verdict.root !== 'exited' || verdict.tree !== 'live') {
        return undefined
      }
      exit.ended = 'withheld'
      lifecycle.cleanup.adopt(sessionId, session.connection, (treeProven) => {
        if (!treeProven) {
          exit.ended = 'published'
        }
        void settleClaudeUnexpectedExit(lifecycle, sessionId, exit).catch(() => undefined)
      })
      return undefined
    })
    .catch(() => undefined)
}

/** Persists the last completed turn, then publishes the `ended` the host releases the lease on. */
export function settleClaudeUnexpectedExit(
  lifecycle: ClaudeExitLifecycle,
  sessionId: string,
  exit: ClaudeSessionExit
): Promise<void> {
  const { exits, deps } = lifecycle
  exit.settlementPromise ??= (async () => {
    exit.session.unbindReadingControl?.()
    if (exits.get(sessionId) !== exit) {
      settleClaudeExitedSession(exit.session)
      return
    }
    // Persist the last completed turn before publishing the lifecycle
    // event that lets the host release and reacquire this exact child.
    await persistClaudeSessionHandle(sessionId, exit.session, deps).catch((error: unknown) => {
      // Recovery still publishes: the record keeps its last durable point, and the loss is logged.
      console.warn('[claude-resume-point] exit cursor was not persisted:', { sessionId, error })
    })
    if (exits.get(sessionId) !== exit) {
      settleClaudeExitedSession(exit.session)
      return
    }
    // Unproven descendants stay indexed as evidence until the host's release retires them.
    if (exit.ended !== 'published') {
      exits.delete(sessionId)
    }
    lifecycle.settledExitErrors.set(sessionId, exit.error)
    const ended: ClaudeStructuredSessionEvent = {
      type: 'ended',
      sessionId,
      reason: exit.error.message,
      cause: 'unexpected-exit',
      fence: exit.session.fence,
      acquisitionGeneration: exit.session.acquisitionGeneration,
      observedAt: deps.now?.() ?? Date.now(),
      ...(exit.session.startup.state === 'proven' ? {} : { startupUnproven: true })
    }
    try {
      lifecycle.emit(exit.session, ended)
    } finally {
      settleClaudeExitedSession(exit.session)
    }
  })()
  return exit.settlementPromise
}

/** Wait for each first-hand exit's publication, including exits observed while waiting. */
export async function drainClaudeObservedExits(
  exits: Map<string, ClaudeSessionExit>
): Promise<void> {
  const awaited = new Set<Promise<void>>()
  for (;;) {
    const pending = [...exits.values()]
      .map((exit) => exit.publication)
      .filter(
        (publication): publication is Promise<void> =>
          publication !== undefined && !awaited.has(publication)
      )
    if (pending.length === 0) {
      return
    }
    for (const publication of pending) {
      awaited.add(publication)
    }
    await Promise.all(pending)
  }
}

export async function persistClaudeSessionHandle(
  sessionId: string,
  session: ClaudeSession,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'persistHandle'>
): Promise<void> {
  const leafUuid = await settledClaudeTurnEndLeaf(session)
  await deps.persistHandle?.({
    sessionId,
    providerSessionId: session.providerSessionId,
    leafUuid,
    fence: session.fence
  })
}
