import type Database from '../../../../sqlite/sync-database'
import { isOrcaSessionId } from '../../../../../shared/orca-session-address'
import {
  STRUCTURED_WORKER_HANDLE_PREFIX,
  STRUCTURED_WORKER_INCARNATION_PREFIX,
  isStructuredWorkerHandle,
  sessionIdFromStructuredWorkerIncarnation,
  structuredWorkerProcessIncarnation
} from '../../../structured-worker-identity'
import { currentRunCoordinatorOrcaSessionIdSql } from '../runs/run-coordinator-orca-session'

const CURRENT_COORDINATOR_ORCA_SESSION_ID_SQL = currentRunCoordinatorOrcaSessionIdSql('runs')

// GLOB is a case-sensitive prefix filter; the canonical predicates still decide every row.
const HANDLE_GLOB = `${STRUCTURED_WORKER_HANDLE_PREFIX}*`
const INCARNATION_GLOB = `${STRUCTURED_WORKER_INCARNATION_PREFIX}*`

const RECORDED_WORKER_SESSIONS_SQL = `
  SELECT assignee_handle AS handle, process_incarnation AS incarnation FROM dispatch_contexts
  WHERE assignee_handle GLOB ? AND process_incarnation GLOB ?
  UNION
  SELECT terminal_handle, process_incarnation FROM worker_terminal_resources
  WHERE terminal_handle GLOB ? AND process_incarnation GLOB ?`

/**
 * Fills the Orca session id on rows that provably belong to a structured worker session and have
 * none: a `structured:<sessionId>` process incarnation, or a `structworker_` handle this host
 * recorded against such an incarnation. Every other row stays NULL, PTY rows included, and evidence
 * naming more than one session proves none. Pane keys are never read: a pane outlives the agent in it.
 *
 * Both markers are minted only for a local, non-WSL session (`structuredWorkerHostScope`), so the
 * rows carrying them were written by this host.
 *
 * Runs after migrate on every open, not only once at v42: a binary rolled back past v42 keeps
 * writing structured-worker rows without an Orca session id after user_version is already 42. It
 * fills only rows with no id that counts, so an id a writer recorded is never rewritten; the one
 * clear is the unbind residue below.
 */
export function backfillStructuredWorkerOrcaSessionIds(db: Database.Database): void {
  let recordedSessions: Map<string, Set<string>> | undefined
  const orcaSessionIdFor = (handle: unknown, incarnation: unknown): string | null => {
    if (incarnation != null && typeof incarnation !== 'string') {
      return null
    }
    const sessions = new Set<string>()
    if (incarnation != null) {
      const sessionId = sessionIdFromStructuredWorkerIncarnation(incarnation)
      if (!sessionId) {
        // A live non-structured incarnation says this row is some other process.
        return null
      }
      sessions.add(sessionId)
    }
    if (typeof handle === 'string' && isStructuredWorkerHandle(handle)) {
      recordedSessions ??= recordedWorkerSessionsByHandle(db)
      for (const sessionId of recordedSessions.get(handle) ?? []) {
        sessions.add(sessionId)
      }
    }
    const [sessionId, ...others] = sessions
    return sessionId && others.length === 0 && isOrcaSessionId(sessionId) ? sessionId : null
  }

  const assignees = db
    .prepare(
      `SELECT id, assignee_handle, process_incarnation FROM dispatch_contexts
       WHERE assignee_orca_session_id IS NULL
         AND (process_incarnation GLOB ? OR assignee_handle GLOB ?)`
    )
    .all(INCARNATION_GLOB, HANDLE_GLOB)
  const setAssignee = db.prepare(
    `UPDATE dispatch_contexts SET assignee_orca_session_id = ?
     WHERE id = ? AND assignee_orca_session_id IS NULL`
  )
  for (const row of assignees) {
    const orcaSessionId = orcaSessionIdFor(row.assignee_handle, row.process_incarnation)
    if (orcaSessionId && typeof row.id === 'string') {
      setAssignee.run(orcaSessionId, row.id)
    }
  }

  const creators = db
    .prepare(
      `SELECT id, creator_handle FROM dispatch_contexts
       WHERE creator_orca_session_id IS NULL AND creator_handle GLOB ?`
    )
    .all(HANDLE_GLOB)
  const setCreator = db.prepare(
    `UPDATE dispatch_contexts SET creator_orca_session_id = ?
     WHERE id = ? AND creator_orca_session_id IS NULL`
  )
  for (const row of creators) {
    const orcaSessionId = orcaSessionIdFor(row.creator_handle, null)
    if (orcaSessionId && typeof row.id === 'string') {
      setCreator.run(orcaSessionId, row.id)
    }
  }

  // A coordinator id left at an older generation counts as none, so the handle's session fills it.
  const coordinators = db
    .prepare(
      `SELECT id, coordinator_handle FROM runs
       WHERE ${CURRENT_COORDINATOR_ORCA_SESSION_ID_SQL} IS NULL AND coordinator_handle GLOB ?`
    )
    .all(HANDLE_GLOB)
  const setCoordinator = db.prepare(
    `UPDATE runs SET coordinator_orca_session_id = ?,
       coordinator_orca_session_id_generation = consumer_generation
     WHERE id = ? AND ${CURRENT_COORDINATOR_ORCA_SESSION_ID_SQL} IS NULL`
  )
  for (const row of coordinators) {
    const orcaSessionId = orcaSessionIdFor(row.coordinator_handle, null)
    if (orcaSessionId && typeof row.id === 'string') {
      setCoordinator.run(orcaSessionId, row.id)
    }
  }
  clearUnboundStructuredWorkerCoordinatorOrcaSessionIds(db)
}

/**
 * Whether this Orca session id was assigned a Dispatch as a structured worker. Such a session always
 * binds a Run with its worker handle, so it can never hold a handle-less binding.
 */
export function isRecordedStructuredWorkerOrcaSessionId(
  db: Database.Database,
  orcaSessionId: string
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM dispatch_contexts
         WHERE assignee_orca_session_id = ? AND process_incarnation = ? LIMIT 1`
      )
      .get(orcaSessionId, structuredWorkerProcessIncarnation(orcaSessionId))
  )
}

/**
 * A binary without the Orca session id column unbinds a structured worker's Run by clearing its
 * handle and pane, which leaves the id looking like a handle-less chat's binding. Only that unbind
 * can make this shape for a worker's id, so the id goes; a chat coordinator's binding is untouched.
 */
function clearUnboundStructuredWorkerCoordinatorOrcaSessionIds(db: Database.Database): void {
  const handleless = db
    .prepare(
      `SELECT id, coordinator_orca_session_id FROM runs
       WHERE coordinator_orca_session_id IS NOT NULL AND coordinator_handle IS NULL
         AND coordinator_pane_key IS NULL`
    )
    .all()
  const clear = db.prepare(
    `UPDATE runs SET coordinator_orca_session_id = NULL
     WHERE id = ? AND coordinator_handle IS NULL AND coordinator_pane_key IS NULL`
  )
  for (const row of handleless) {
    const orcaSessionId = row.coordinator_orca_session_id
    if (typeof row.id === 'string' && typeof orcaSessionId === 'string') {
      if (isRecordedStructuredWorkerOrcaSessionId(db, orcaSessionId)) {
        clear.run(row.id)
      }
    }
  }
}

function recordedWorkerSessionsByHandle(db: Database.Database): Map<string, Set<string>> {
  const sessionsByHandle = new Map<string, Set<string>>()
  const rows = db
    .prepare(RECORDED_WORKER_SESSIONS_SQL)
    .all(HANDLE_GLOB, INCARNATION_GLOB, HANDLE_GLOB, INCARNATION_GLOB)
  for (const row of rows) {
    const sessionId =
      typeof row.incarnation === 'string'
        ? sessionIdFromStructuredWorkerIncarnation(row.incarnation)
        : null
    if (typeof row.handle !== 'string' || !sessionId) {
      continue
    }
    const sessions = sessionsByHandle.get(row.handle) ?? new Set<string>()
    sessions.add(sessionId)
    sessionsByHandle.set(row.handle, sessions)
  }
  return sessionsByHandle
}
