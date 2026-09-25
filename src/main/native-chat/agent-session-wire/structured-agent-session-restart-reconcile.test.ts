import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session-record.test-fixture'
import { createRestartReconciler } from './structured-agent-session-restart-reconcile'

const hostRun = { resolve: async () => ({ runId: 'run-1', pid: 1, machine: 'test-os:box' }) }

describe('createRestartReconciler', () => {
  it('reruns after an external store refresh introduces unreconciled leases', async () => {
    let record = { sessionId: 'session-1', lease: { unreconciled: true } } as AgentSessionRecord
    const reconcileOnRestart = vi.fn(async () => {
      record = { ...record, lease: { ...record.lease, unreconciled: false } }
      return new Map()
    })
    const store = {
      listRecords: () => [record],
      getRecord: () => record,
      reconcileOnRestart,
      hostRun
    }
    const reconcile = createRestartReconciler({
      store,
      probe: async () => ({ outcome: 'pid-absent' }),
      now: () => 1
    })

    expect(await reconcile('session-1')).toBeNull()
    record = { ...record, lease: { ...record.lease, unreconciled: true } }
    expect(await reconcile('session-1')).toBeNull()
    expect(reconcileOnRestart).toHaveBeenCalledTimes(2)
  })

  it('retries an unread machine id once per reconcile, not once per pass', async () => {
    let passes = 0
    const record = () =>
      agentSessionRecordFixture(agentSessionLeaseFixture({ unreconciled: passes < 2 }))
    const resolveHostRun = vi.fn(hostRun.resolve)
    const store = {
      listRecords: () => [record()],
      getRecord: () => record(),
      reconcileOnRestart: vi.fn(async () => {
        passes += 1
        return new Map()
      }),
      hostRun: { resolve: resolveHostRun }
    }
    const reconcile = createRestartReconciler({
      store,
      probe: async () => ({ outcome: 'pid-absent' }),
      now: () => 1
    })

    expect(await reconcile('session-1')).toBeNull()
    expect(passes).toBe(2)
    expect(resolveHostRun).toHaveBeenCalledOnce()
    // Settled: an operation that finds nothing to adjudicate looks nothing up.
    expect(await reconcile('session-1')).toBeNull()
    expect(resolveHostRun).toHaveBeenCalledOnce()
  })

  it('passes every pending record through the batch owner probe', async () => {
    let records = [
      { sessionId: 'session-1', lease: { unreconciled: true } },
      { sessionId: 'session-2', lease: { unreconciled: true } }
    ] as AgentSessionRecord[]
    const probe = vi.fn(async () => ({ outcome: 'pid-absent' as const }))
    const probeMany = vi.fn(async (pending: readonly AgentSessionRecord[]) => {
      return new Map(
        pending.map((record) => [record.sessionId, { outcome: 'pid-absent' as const }])
      )
    })
    const reconcileOnRestart = vi.fn(
      async (args: {
        probeMany?: (pending: readonly AgentSessionRecord[]) => Promise<unknown>
      }) => {
        await args.probeMany?.(records)
        records = records.map((record) => ({
          ...record,
          lease: { ...record.lease, unreconciled: false }
        }))
        return new Map()
      }
    )
    const store = {
      listRecords: () => records,
      getRecord: (sessionId: string) =>
        records.find((record) => record.sessionId === sessionId) ?? null,
      reconcileOnRestart,
      hostRun
    }

    await expect(
      createRestartReconciler({ store, probe, probeMany, now: () => 1 })('session-1')
    ).resolves.toBeNull()

    expect(probeMany).toHaveBeenCalledOnce()
    expect(probeMany.mock.calls[0]?.[0].map((record) => record.sessionId)).toEqual([
      'session-1',
      'session-2'
    ])
    expect(probe).not.toHaveBeenCalled()
  })
})
