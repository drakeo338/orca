// A chat interrupted mid-turn by a restart, rebuilt on a fresh host over the same store, for the
// restart-resume ownership and failure tests.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import {
  AgentSessionRecoveryCapsule,
  AGENT_SESSION_RECOVERY_CAPSULE_FILE
} from '../../runtime/agent-session-recovery-capsule'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { parseAgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'
import {
  AGENT_SESSION_RESTART_INTERRUPTION_NOTE,
  AGENT_SESSION_RESTART_INTERRUPTION_PRESENTATION
} from '../../../shared/agent-session-restart-interruption'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
import { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { restartedAgentSessionHostRun } from '../../runtime/agent-session-host-run.test-fixture'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host-types'
import { StructuredAgentSessionResumeAdmission } from './structured-agent-session-restart-resume-runner'
import {
  adapter,
  attach,
  CALLER,
  envelope,
  hostTestState,
  replaceHostTestState
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestMessage
} from './structured-agent-session-host-test-data'

export const GRACE = 15_000

export async function interruptedRestart(
  work: 'turn' | 'submission' = 'turn',
  historyBoundaryConsistent = true
) {
  const previous = hostTestState()
  await attach()
  const events = previous.acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing provider event sink')
  }
  if (work === 'submission') {
    previous.dispatch.mockResolvedValueOnce({ state: 'admitted' })
    const body = hostTestMessage('Perform the original task')
    await previous.host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
  } else {
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'interrupted-turn', ordinal: 1 },
      { kind: 'turn', turnId: 'interrupted-turn', state: 'running' }
    )
  }
  await previous.host.flushStreamedEvents(SESSION)
  await previous.host.flushAllStreamedEvents()
  const store = await AgentSessionRecordStore.open({
    directory: join(previous.root, 'store'),
    hostId: 'local'
  })
  const closeSession = vi.fn(async () => true)
  const host = new StructuredAgentSessionHost({
    store,
    adapter: {
      ...adapter(),
      closeSession,
      ...(work === 'submission'
        ? {
            providerHistoryWindow: async () => ({
              items: [],
              boundaryConsistent: historyBoundaryConsistent,
              turnInFlight: false
            })
          }
        : {})
    },
    journalRoot: previous.root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-next',
    probeOwner: async () => ({ outcome: 'pid-absent' }),
    recoveryCapsule: new AgentSessionRecoveryCapsule(previous.root),
    releaseGraceMs: GRACE,
    now: () => NOW
  })
  replaceHostTestState({ store, host })
  previous.acquire.mockClear()
  previous.releaseAcquisition.mockClear()
  previous.dispatch.mockClear()
  const capsule = JSON.parse(
    await readFile(join(previous.root, AGENT_SESSION_RECOVERY_CAPSULE_FILE), 'utf8')
  )
  const marker = parseAgentSessionResumeMarker(capsule.entries[0]?.marker)
  return { ...hostTestState(), host, store, closeSession, marker }
}

/** A chat with a tab whose provider opened `turn-1` and left it `state`. */
export async function runTurnBeforeRestart(state: 'running' | 'completed'): Promise<void> {
  const previous = hostTestState()
  await attach()
  // The chat has a tab, so the pane's read after the restart is one the host serves.
  await previous.store.setSessionTabVisibility(SESSION, true)
  const events = previous.acquire.mock.calls.at(-1)?.[0].events
  if (!events) {
    throw new Error('missing provider event sink')
  }
  events.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 1 },
    { kind: 'turn', turnId: 'turn-1', state }
  )
  await previous.host.flushStreamedEvents(SESSION)
}

/** A crash: the process is gone without any teardown, so nothing settled its turn. */
async function crash(host: StructuredAgentSessionHost): Promise<void> {
  host['runtimeState'].stopLeaseRenewal()
  host['holds'].dispose()
  await Promise.all([...host['sessions'].values()].map((session) => session.journal.close()))
  host['sessions'].clear()
}

/** The next app run over the same profile: a new host run, so the old one's leases are its dead. */
export async function relaunchAfter(
  how: 'quit' | 'crash',
  deps: Partial<StructuredAgentSessionHostDeps> = {}
): Promise<StructuredAgentSessionHost> {
  const previous = hostTestState()
  await (how === 'quit'
    ? previous.host.flushAllStreamedEvents({ trigger: 'quit' })
    : crash(previous.host))
  const store = await AgentSessionRecordStore.open({
    directory: join(previous.root, 'store'),
    hostId: 'local',
    hostRun: await restartedAgentSessionHostRun()
  })
  const host = new StructuredAgentSessionHost({
    store,
    adapter: adapter(),
    journalRoot: previous.root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-next',
    now: () => NOW,
    ...deps
  })
  replaceHostTestState({ store, host })
  return host
}

/** The distinct restart notes among what a subscriber received. */
export function restartNoteIdsIn(events: readonly AgentSessionSubscribeEvent[]): unknown[] {
  const items = events.flatMap((event) =>
    event.type === 'snapshot' ? event.page.items : event.type === 'batch' ? event.batch.items : []
  )
  const ids = new Set(
    items
      .filter(
        (item) =>
          item.body.kind === 'status' &&
          item.body.presentation === AGENT_SESSION_RESTART_INTERRUPTION_PRESENTATION &&
          item.body.text === AGENT_SESSION_RESTART_INTERRUPTION_NOTE
      )
      .map((item) => item.itemId)
  )
  return [...ids]
}

export function statusNotes(host: StructuredAgentSessionHost) {
  return host
    .journalSnapshot(SESSION)
    .items.flatMap((item) =>
      item.body.kind === 'status' ? [{ text: item.body.text, tone: item.body.tone }] : []
    )
}

/** A reattach that succeeds and a continuation the host refuses: the provider finished the turn
 *  while the continuation was being recorded, as the superseded-evidence cases above set up. */
/** `userAnswers` has the user reply in the chat just before or after its own attempt, while the
 *  rest of a batch would still be running. */
export async function supersededRefusal(userAnswers?: 'before' | 'after') {
  const { host, acquire, dispatch, root } = await interruptedRestart()
  await host.restartResume.list()
  await host.hold(SESSION, 'pane')
  const events = acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing resumed provider event sink')
  }
  const append = AgentSessionJournal.prototype.appendSubmission
  const writing = vi.spyOn(AgentSessionJournal.prototype, 'appendSubmission')
  writing.mockImplementationOnce(async function (this: AgentSessionJournal, input) {
    const cursor = await append.call(this, input)
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'interrupted-turn', ordinal: 1 },
      { kind: 'turn', turnId: 'interrupted-turn', state: 'completed' },
      { lifecycle: true }
    )
    return cursor
  })
  const admit = StructuredAgentSessionResumeAdmission.prototype.run
  const admitting = vi.spyOn(StructuredAgentSessionResumeAdmission.prototype, 'run')
  const body = hostTestMessage('Carry on from where you stopped')
  const answer = () =>
    host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
  if (userAnswers) {
    admitting.mockImplementationOnce(async function (this, ...args) {
      await (userAnswers === 'before' ? answer() : null)
      try {
        return await admit.apply(this, args)
      } finally {
        await (userAnswers === 'after' ? answer() : null)
      }
    })
  }
  try {
    const result = await host.restartResume.continueAfterRestart([SESSION], 'modal')
    expect(result.continued).toMatchObject([{ outcome: 'refused' }])
    expect(dispatch).toHaveBeenCalledTimes(userAnswers ? 1 : 0)
    return { host, root, result }
  } finally {
    writing.mockRestore()
    admitting.mockRestore()
  }
}
