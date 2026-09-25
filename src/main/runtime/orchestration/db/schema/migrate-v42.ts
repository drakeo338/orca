import type { OrchestrationDb } from '../orchestration-db'
import { currentRunCoordinatorAddressSql } from '../runs/run-coordinator-orca-session'

const ORCA_SESSION_ID_COLUMNS = [
  ['runs', 'coordinator_orca_session_id', 'TEXT'],
  ['runs', 'coordinator_orca_session_id_generation', 'INTEGER'],
  ['dispatch_contexts', 'assignee_orca_session_id', 'TEXT'],
  ['dispatch_contexts', 'creator_orca_session_id', 'TEXT']
] as const

const NEW_COORDINATOR_ADDRESS_SQL = currentRunCoordinatorAddressSql('NEW')

/**
 * Orca session id columns (bare ids, see orca-session-address): which structured session a Run's
 * coordinator and a Dispatch's assignee and creator are when that party is one. PTY rows keep NULL
 * and keep their handle and pane-key identity. Existing structured-worker rows get their id from
 * `backfillStructuredWorkerOrcaSessionIds`, which runs after migrate on every open. A coordinator's
 * id carries the consumer generation it was written at and counts only at that generation.
 * The id is the one the agent is addressed by: for a `/clear`ed chat, its lineage root's, not the live one.
 *
 * Dev databases stamped v42 by earlier builds hold `*_principal` or `*_actor` columns instead. They
 * are unsupported: the version-skew probe finds a column missing and replays the chain, which adds
 * these columns and leaves the stale ones unread.
 */
export function migrateV42(this: OrchestrationDb, current: number): void {
  if (current >= 42) {
    return
  }
  // Guarded because createTables runs first on every open and already gives a fresh database these.
  for (const [table, column, type] of ORCA_SESSION_ID_COLUMNS) {
    if (!this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }
  // A Run lookup that ORs a pane-leaf match with an Orca session id match scans every Run without this index.
  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_coordinator_orca_session_id
      ON runs(coordinator_orca_session_id) WHERE coordinator_orca_session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dispatch_assignee_orca_session_id
      ON dispatch_contexts(assignee_orca_session_id) WHERE assignee_orca_session_id IS NOT NULL;
  `)
  // A handle-less coordinator is remembered by its session address, `session:<id>`, so every reader
  // of this cache matches it by string equality, unchanged. This step owns the trigger form: the
  // static createTables SQL must stay handle-only (see create-core-tables-sql), and CREATE TRIGGER IF
  // NOT EXISTS never replaces an existing database's triggers, so they are dropped and recreated by name.
  this.db.exec(`
    DROP TRIGGER IF EXISTS trg_runs_remember_coordinator_insert;
    DROP TRIGGER IF EXISTS trg_runs_remember_coordinator_update;
    CREATE TRIGGER trg_runs_remember_coordinator_insert
    AFTER INSERT ON runs
    WHEN NEW.legacy = 0 AND ${NEW_COORDINATOR_ADDRESS_SQL} IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO run_coordinator_handles (run_id, terminal_handle)
      VALUES (NEW.id, ${NEW_COORDINATOR_ADDRESS_SQL});
    END;
    CREATE TRIGGER trg_runs_remember_coordinator_update
    AFTER UPDATE OF coordinator_handle, coordinator_orca_session_id,
      coordinator_orca_session_id_generation ON runs
    WHEN NEW.legacy = 0 AND ${NEW_COORDINATOR_ADDRESS_SQL} IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO run_coordinator_handles (run_id, terminal_handle)
      VALUES (NEW.id, ${NEW_COORDINATOR_ADDRESS_SQL});
    END;
  `)
}
