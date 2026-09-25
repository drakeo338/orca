import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatOrcaSessionAddress,
  parseOrcaSessionAddress
} from '../../../shared/orca-session-address'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerProcessIncarnation
} from '../structured-worker-identity'
import { OrchestrationDb } from './db'
import { backfillStructuredWorkerOrcaSessionIds } from './db/schema/structured-worker-orca-session-backfill'

const CHAT_SESSION_ID = '3a5c7e9b-1d4f-4a6c-8b0e-2f4a6c8e0b14'
const CHAT_ADDRESS = formatOrcaSessionAddress(CHAT_SESSION_ID)
const WORKER_SESSION_ID = '4b6d8f0c-2e5a-4b7d-9c1f-3a5b7d9f1c25'
const PTY_PANE = 'tab_pty:66666666-6666-4666-8666-666666666666'

function addressesFor(db: OrchestrationDb, runId: string): string[] {
  return db.db
    .prepare('SELECT terminal_handle FROM run_coordinator_handles WHERE run_id = ?')
    .all(runId)
    .map((row) => String(row.terminal_handle))
    .sort()
}

/** A handle-less coordinator row; no writer records one until the caller resolver lands. */
function insertSessionCoordinatedRun(db: OrchestrationDb, runId: string): void {
  db.db
    .prepare(
      `INSERT INTO runs (
         id, objective, coordinator_orca_session_id, coordinator_orca_session_id_generation,
         consumer_generation, legacy
       ) VALUES (?, 'coordinated by a structured session', ?, 1, 1, 0)`
    )
    .run(runId, CHAT_SESSION_ID)
}

describe('Run coordinator Orca session address', () => {
  let db: OrchestrationDb | undefined
  const tempRoots: string[] = []

  afterEach(() => {
    db?.close()
    db = undefined
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('remembers a handle-less session coordinator by the address derived from its bare id', () => {
    db = new OrchestrationDb(':memory:')
    insertSessionCoordinatedRun(db, 'run_session')

    // The column holds the bare id; only the remembered address carries the session: prefix.
    expect(db.getRunRaw('run_session')?.coordinator_orca_session_id).toBe(CHAT_SESSION_ID)
    expect(addressesFor(db, 'run_session')).toEqual([CHAT_ADDRESS])
    expect(parseOrcaSessionAddress(addressesFor(db, 'run_session')[0])).toBe(CHAT_SESSION_ID)
    expect(db.getRunMailboxOwnerIdsForHandle(CHAT_ADDRESS)).toEqual(['run_session'])
    expect(db.getRunMailboxOwnerIdsForHandle(CHAT_SESSION_ID)).toEqual([])
    // The existing routing trigger matches the address by string equality, unchanged.
    const reply = db.insertMessage({
      runId: 'run_session',
      from: 'term_worker',
      to: CHAT_ADDRESS,
      subject: 'done',
      type: 'worker_done'
    })
    expect(db.getMessageById(reply.id)?.to_handle).toBe('run:run_session')
  })

  it('remembers an Orca session id bound by update, and again on reopen when the cache row is gone', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-run-coordinator-orca-session-'))
    tempRoots.push(root)
    const path = join(root, 'orchestration.db')
    db = new OrchestrationDb(path)
    db.db
      .prepare(
        `INSERT INTO runs (id, objective, consumer_generation, legacy)
         VALUES ('run_unbound', 'bound later', 1, 0)`
      )
      .run()
    db.db
      .prepare(
        `UPDATE runs SET coordinator_orca_session_id = ?,
           coordinator_orca_session_id_generation = consumer_generation
         WHERE id = ?`
      )
      .run(CHAT_SESSION_ID, 'run_unbound')
    expect(addressesFor(db, 'run_unbound')).toEqual([CHAT_ADDRESS])
    db.db.prepare('DELETE FROM run_coordinator_handles WHERE run_id = ?').run('run_unbound')
    db.close()

    db = new OrchestrationDb(path)
    expect(addressesFor(db, 'run_unbound')).toEqual([CHAT_ADDRESS])
  })

  it('keeps PTY coordinators remembered by handle alone', () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'pty',
      coordinatorHandle: 'term_first',
      coordinatorPaneKey: PTY_PANE
    })
    db.bindRun({
      runId: run.id,
      coordinatorHandle: 'term_second',
      coordinatorPaneKey: 'tab_second:77777777-7777-4777-8777-777777777777'
    })

    expect(db.getRunRaw(run.id)?.coordinator_orca_session_id).toBeNull()
    expect(addressesFor(db, run.id)).toEqual(['term_first', 'term_second'])
  })

  it("never leaves a replaced structured coordinator's Orca session id on the Run", () => {
    db = new OrchestrationDb(':memory:')
    const handle = mintStructuredWorkerHandle()
    const pane = mintStructuredWorkerPaneKey(WORKER_SESSION_ID)
    const ownTask = db.createTask({ runId: 'run_legacy_local', spec: 'structured worker' })
    db.createDispatchContext({
      taskId: ownTask.id,
      assigneeHandle: handle,
      assigneePaneKey: pane,
      processIncarnation: structuredWorkerProcessIncarnation(WORKER_SESSION_ID),
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    const first = db.createRun({
      objective: 'first',
      coordinatorHandle: handle,
      coordinatorPaneKey: pane
    })
    backfillStructuredWorkerOrcaSessionIds(db.db)
    expect(db.getRunRaw(first.id)?.coordinator_orca_session_id).toBe(WORKER_SESSION_ID)

    // A second Run from the same pane unbinds the first.
    const second = db.createRun({
      objective: 'second',
      coordinatorHandle: handle,
      coordinatorPaneKey: pane
    })
    expect(db.getRunRaw(first.id)).toMatchObject({
      coordinator_handle: null,
      coordinator_orca_session_id: null
    })

    backfillStructuredWorkerOrcaSessionIds(db.db)
    expect(db.getRunRaw(second.id)?.coordinator_orca_session_id).toBe(WORKER_SESSION_ID)
    db.bindRun({ runId: second.id, coordinatorHandle: 'term_taker', coordinatorPaneKey: PTY_PANE })
    expect(db.getRunRaw(second.id)).toMatchObject({
      coordinator_handle: 'term_taker',
      coordinator_orca_session_id: null
    })
    // Neither Run ever became reachable at the worker's session address.
    expect(db.getRunMailboxOwnerIdsForHandle(formatOrcaSessionAddress(WORKER_SESSION_ID))).toEqual(
      []
    )
  })
})
