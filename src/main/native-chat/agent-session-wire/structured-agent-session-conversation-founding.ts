// A conversation exists from its reservation, not from its first live provider child.
//
// The journal used to be opened only once acquisition succeeded, so a create whose child died at
// startup left a record and nothing to read: no chat to publish, and nothing a later send could be
// admitted into. Founding it here makes that create an ordinary readable session with a released
// lease, which a send restarts like any other.

import { existsSync } from 'node:fs'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { agentSessionJournalCloseRetries } from '../agent-session-journal/journal-close-retry'
import type { JournalReplacementItem } from '../agent-session-journal/journal-epoch-replacement'
import { journalDatabaseFile, journalDirectoryFor } from '../agent-session-journal/journal-paths'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import { importAdoptedTranscript } from './structured-agent-session-adopted-import'
import {
  journalIdentityFor,
  type AgentSessionAttachParams
} from './structured-agent-session-attach'

export async function foundAgentSessionConversation(input: {
  record: AgentSessionRecord
  params: AgentSessionAttachParams
  journalRoot: string
  adoptedItems: JournalReplacementItem[] | null
}): Promise<void> {
  const journalDir = journalDirectoryFor(input.journalRoot, {
    workspaceId: input.params.location.workspaceId,
    sessionId: input.record.sessionId
  })
  // An adopted conversation whose import never landed is still owed it; the import skips a
  // journal that already holds more than its epoch.
  if (existsSync(journalDatabaseFile(journalDir)) && !input.params.adopt) {
    return
  }
  const journal = await openAgentSessionJournal({
    identity: journalIdentityFor(input.record, input.params),
    journalDir
  })
  try {
    await importAdoptedTranscript(input.params, journal, input.record, input.adoptedItems)
  } finally {
    await agentSessionJournalCloseRetries.closeOrRetain(journal)
  }
}
