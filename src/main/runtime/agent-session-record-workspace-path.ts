import type { AgentSessionRecord } from '../../shared/agent-session-record'

/**
 * Pin the directory a session's provider was launched in.
 *
 * First writer wins: the pin records where the session ran, so no later launch may move it — a
 * move would be an explicit act, not a side effect of resolving a workspace again.
 */
export function pinAgentSessionRecordWorkspacePath(
  record: AgentSessionRecord,
  workspacePath: string,
  now: number
): AgentSessionRecord {
  if (record.workspacePath !== undefined) {
    return record
  }
  return { ...record, workspacePath, updatedAt: now }
}
