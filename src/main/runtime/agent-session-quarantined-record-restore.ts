import { isAgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionStoreState } from './agent-session-record-store-file'

/**
 * A build that could not validate a record kept its bytes; a build that can takes it back. Never
 * over a copy the file also holds under `records`: that one is newer, readable or not.
 */
export function restoreQuarantinedRecord(
  state: AgentSessionStoreState,
  sessionId: string,
  raw: unknown,
  fileRecords: unknown
): boolean {
  if (
    !isAgentSessionRecord(raw) ||
    raw.sessionId !== sessionId ||
    (typeof fileRecords === 'object' &&
      fileRecords !== null &&
      Object.hasOwn(fileRecords, sessionId))
  ) {
    return false
  }
  state.records.set(sessionId, raw)
  return true
}
