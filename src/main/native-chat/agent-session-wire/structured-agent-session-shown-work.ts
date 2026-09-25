// Whether a structured session is doing work, asked the one way the product answers it.
//
// The status feed publishes the lead's journal status beside the provider's live background roster,
// and the store ingest folds the two into the row the sidebar shows. The sidebar projection counts
// an admitted submission as working while it waits for a provider turn; the lifetime projection
// deliberately excludes that unresolved send so an unheld child can eventually settle it.

import type { AgentSessionBackgroundTask } from '../../../shared/agent-session-background-task-wire'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import {
  structuredAgentSessionAgentStatus,
  type StructuredAgentSessionAgentStatus
} from '../../../shared/structured-agent-session-agent-status'
import { projectStructuredAgentSessionStatus } from '../../../shared/structured-agent-session-projection'

/** The full row the sidebar's fold would show, for callers that need the lead's own state beside
 *  the working answer — the teardown snapshot records both from this one computation. */
export function structuredAgentSessionShownStatus(
  journal: {
    items: readonly AgentJournalRenderItem[]
    submissions: readonly AgentJournalSubmission[]
  },
  backgroundTasks: readonly AgentSessionBackgroundTask[] | null | undefined,
  /** The session's lease fence, as the status feed passes it: a send from an older one is not work. */
  fence: number | undefined
): StructuredAgentSessionAgentStatus {
  const status = projectStructuredAgentSessionStatus(journal.items, journal.submissions, fence)
  return structuredAgentSessionAgentStatus({
    status,
    ...(backgroundTasks ? { backgroundTasks: [...backgroundTasks] } : {})
  })
}

export function structuredAgentSessionShowsWork(
  journal: {
    items: readonly AgentJournalRenderItem[]
    submissions: readonly AgentJournalSubmission[]
  },
  backgroundTasks: readonly AgentSessionBackgroundTask[] | null | undefined,
  fence: number | undefined
): boolean {
  return structuredAgentSessionShownStatus(journal, backgroundTasks, fence).state !== 'done'
}

/**
 * Whether an unheld provider still owns work that should keep it alive.
 *
 * An admitted submission with no turn is an unresolved delivery obligation, so the sidebar shows
 * it as working. It cannot keep a provider child alive indefinitely, though: the idle release must
 * eventually stop that child and settle the submission as interrupted. Turns, prompts, and live
 * background tasks remain work here because they are independently observable after the send.
 */
export function structuredAgentSessionHasOwedWork(
  journal: {
    items: readonly AgentJournalRenderItem[]
    submissions: readonly AgentJournalSubmission[]
  },
  backgroundTasks: readonly AgentSessionBackgroundTask[] | null | undefined,
  fence: number | undefined
): boolean {
  const status = projectStructuredAgentSessionStatus(journal.items, [], fence)
  return (
    structuredAgentSessionAgentStatus({
      status,
      ...(backgroundTasks ? { backgroundTasks: [...backgroundTasks] } : {})
    }).state !== 'done'
  )
}
