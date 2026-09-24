// A create makes a conversation and tries to start its agent. When only the start fails, the
// conversation still exists: its journal was founded at reservation. The create answers it as a
// readable chat whose first row says why the agent stopped, and a send restarts the agent through
// the host's ensure-owner step like any chat whose child ended — there is no second restart path.
//
// Only a start whose child is proven gone qualifies. A definitive refusal still answers as one, so
// the client falls back instead; an unverifiable one still answers as unknown, so the client
// reconciles instead.

import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import { isDefinitiveAgentSessionCreateRefusal } from '../../../shared/agent-session-definitive-refusal'
import { readAgentSessionHydrationPage } from './agent-session-history-page'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import { providerStartupFailureOutcome } from './structured-agent-session-dead-generation-settlement'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import { recordStructuredAgentSessionStartFailure } from './structured-agent-session-start-failure-row'

type FailedCreateContext = Pick<
  StructuredAgentSessionMutationContext,
  'deps' | 'sessions' | 'restoreReadable' | 'publish'
>
type CreateResult = AgentSessionMutationResult<AgentSessionAttachResult>

export async function answerStructuredAgentSessionCreate(
  attached: Promise<CreateResult>,
  params: AgentSessionAttachParams,
  /** Runs the read inside the session's serialize. */
  serialized: (
    read: (context: FailedCreateContext) => Promise<CreateResult | null>
  ) => Promise<CreateResult | null>
): Promise<CreateResult> {
  const result = await attached
  if (result.ok) {
    return result
  }
  const { sessionId, clientOperationId } = params.envelope
  const created = await serialized((context) =>
    readFailedCreate(context, {
      sessionId,
      operationId: clientOperationId,
      refusal: result.refusal
    })
  )
  return created ?? result
}

/** Null leaves the create's refusal as its answer. */
async function readFailedCreate(
  context: FailedCreateContext,
  input: { sessionId: string; operationId: string; refusal: AgentSessionWireRefusal }
): Promise<CreateResult | null> {
  const { sessionId, refusal } = input
  if (refusal.ownerVerdict !== 'exited' || isDefinitiveAgentSessionCreateRefusal(refusal.code)) {
    return null
  }
  let session: Awaited<ReturnType<typeof recordStructuredAgentSessionStartFailure>>
  try {
    session = await recordStructuredAgentSessionStartFailure(
      context,
      sessionId,
      `failed-start:${input.operationId}`,
      providerStartupFailureOutcome(refusal.message)
    )
  } catch (error) {
    // Bookkeeping: the refusal still reaches the user, whose Retry is a fresh create.
    context.deps.onEventSinkError?.({ sessionId, error })
    return null
  }
  if (!session) {
    return null
  }
  const { fence, journal } = session
  const tabId = context.deps.store.getRecord(sessionId)?.surfaceTabId
  return {
    ok: true,
    replayed: false,
    fence,
    cursor: journal.cursor(),
    value: {
      sessionId,
      fence,
      page: readAgentSessionHydrationPage(journal, fence),
      unconfirmedClientMessageIds: [],
      ...(tabId ? { tabId } : {})
    }
  }
}
