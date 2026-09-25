// What a refused resume means, and the row it leaves in the chat.
//
// Every asker — a surface hold, a send, provider-exit recovery — resumes through the same attach,
// so the row is written there, once per attempt, and reads the same whoever asked. A refusal that
// only says someone else is settling the lease writes nothing: it is not proof the chat cannot run.

import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionWireRefusal } from '../../../shared/agent-session-wire'
import type { AgentSessionWireRefusalCode } from '../../../shared/agent-session-wire-refusals'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../shared/tui-agent-display-names'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import {
  ownerRestartFailedOutcome,
  providerStartupFailureOutcome
} from './structured-agent-session-dead-generation-settlement'
import { recordStructuredAgentSessionStartFailure } from './structured-agent-session-start-failure-row'

export type StructuredAgentSessionResumeRefusalOutcome = 'transient' | 'failed' | 'unresumable'

/**
 * `transient`: the resume met a lease someone else is settling, which is not proof it cannot
 * resume. `failed`: the restart itself failed; the user may clear the cause and retry.
 * `unresumable`: this host has nothing to restart the chat from — no record, or none it can run —
 * so only a new chat continues. A new wire code does not compile until it is classified here.
 */
const RESUME_REFUSAL_OUTCOME: Record<
  AgentSessionWireRefusalCode,
  StructuredAgentSessionResumeRefusalOutcome
> = {
  execution_owner_reconciling: 'transient',
  agent_session_conflict: 'transient',
  agent_session_checkpoint_stale: 'transient',
  agent_session_ownership_unknown: 'transient',
  agent_session_operation_capacity: 'transient',
  structured_agent_session_unsupported: 'unresumable',
  agent_session_operation_conflict: 'failed',
  agent_session_operation_expired: 'failed',
  agent_session_operation_invalid: 'failed',
  agent_session_operation_unknown: 'failed',
  agent_session_item_revision_stale: 'failed',
  agent_session_already_resolved: 'failed',
  agent_session_identity_required: 'unresumable',
  agent_session_journal_unreadable: 'failed',
  agent_session_owner_restart_failed: 'failed'
}

export function structuredAgentSessionResumeRefusalOutcome(
  refusal: AgentSessionWireRefusal
): StructuredAgentSessionResumeRefusalOutcome {
  return RESUME_REFUSAL_OUTCOME[refusal.code]
}

/** The cause in the chat's words: a child the failed attach proved gone died starting, so it reads
 *  as any start that died; otherwise the restart's own cause, with a new chat offered only when
 *  nothing here could restart it. */
export function failedStructuredAgentSessionResumeText(
  record: Pick<AgentSessionRecord, 'provider'>,
  refusal: AgentSessionWireRefusal
): string {
  return refusal.ownerVerdict === 'exited'
    ? providerStartupFailureOutcome(refusal.message)
    : ownerRestartFailedOutcome({
        agentName: TUI_AGENT_DISPLAY_NAMES[record.provider],
        reason: refusal.message,
        resumable: structuredAgentSessionResumeRefusalOutcome(refusal) !== 'unresumable'
      })
}

/** Writes the refused resume into the chat as a start that failed, once per attempt. Bookkeeping:
 *  a write that fails is reported and never changes the refusal the asker gets. */
export async function recordFailedStructuredAgentSessionResume(input: {
  context: Pick<StructuredAgentSessionAttachContext, 'deps' | 'sessions' | 'subscribers'>
  restoreReadable: (sessionId: string) => Promise<boolean>
  sessionId: string
  /** The resume attempt; one attempt writes at most one row. */
  operationId: string
  refusal: AgentSessionWireRefusal
}): Promise<void> {
  const { context, sessionId, refusal } = input
  const record = context.deps.store.getRecord(sessionId)
  if (!record || structuredAgentSessionResumeRefusalOutcome(refusal) === 'transient') {
    return
  }
  try {
    await recordStructuredAgentSessionStartFailure(
      {
        sessions: context.sessions,
        restoreReadable: input.restoreReadable,
        publish: (id, journal) => context.subscribers.publish(id, journal)
      },
      sessionId,
      `failed-restart:${input.operationId}`,
      failedStructuredAgentSessionResumeText(record, refusal)
    )
  } catch (error) {
    context.deps.onEventSinkError?.({ sessionId, error })
  }
}
