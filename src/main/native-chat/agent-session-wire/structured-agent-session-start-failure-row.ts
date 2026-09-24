import { boundJournalStatusText } from '../agent-session-journal/journal-prompt-body-bounds'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'

/**
 * The status row a start that failed leaves in the chat, so the reason outlives any error strip.
 * The journal is made readable for it when no session holds it. Keyed by the operation that met
 * the failure, not the clock, so a replay of that operation adds no second row. Answers the session
 * it wrote to, or null when the conversation has nothing to read.
 */
export async function recordStructuredAgentSessionStartFailure(
  context: Pick<StructuredAgentSessionMutationContext, 'sessions' | 'restoreReadable' | 'publish'>,
  sessionId: string,
  settlementId: string,
  text: string
): Promise<StructuredAgentSessionHostSession | null> {
  if (!context.sessions.has(sessionId)) {
    await context.restoreReadable(sessionId)
  }
  const session = context.sessions.get(sessionId)
  if (!session) {
    return null
  }
  await session.journal.appendLifecycleBatch({
    settlementId,
    fence: session.fence,
    recovered: true,
    mutations: [
      {
        kind: 'item',
        identity: { provider: 'orca', clientMessageId: settlementId },
        body: { kind: 'status', text: boundJournalStatusText(text) }
      }
    ]
  })
  context.publish(sessionId, session.journal)
  return session
}
