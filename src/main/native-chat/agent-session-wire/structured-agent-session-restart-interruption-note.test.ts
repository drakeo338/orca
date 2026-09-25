// The note a cut-off turn gets when Orca itself went away, asserted where clients read it: the
// subscribe snapshot and live batches, not the journal file.

import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
import { agentSessionStorePath } from '../../runtime/agent-session-record-store-file'
import { restartedAgentSessionHostRun } from '../../runtime/agent-session-host-run.test-fixture'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import { HOST_TEST_SESSION as SESSION } from './structured-agent-session-host-test-data'
import {
  relaunchAfter,
  restartNoteIdsIn,
  runTurnBeforeRestart
} from './structured-agent-session-restart-interruption-test-harness'

async function readAfterRestart(host: StructuredAgentSessionHost) {
  await host.ensureReadable(SESSION)
  const events: AgentSessionSubscribeEvent[] = []
  const dispose = host.subscribe({ id: 'pane', sessionId: SESSION, emit: (e) => events.push(e) })
  dispose()
  return events
}

it.each(['quit', 'crash'] as const)(
  'shows one restart note on a turn a %s cut off, across repeated restarts',
  async (how) => {
    await runTurnBeforeRestart('running')

    const first = await relaunchAfter(how)
    expect(restartNoteIdsIn(await readAfterRestart(first))).toHaveLength(1)

    const second = await relaunchAfter(how)
    expect(restartNoteIdsIn(await readAfterRestart(second))).toHaveLength(1)
  }
)

it.each(['quit', 'crash'] as const)(
  'writes no restart note for a turn that finished before the %s',
  async (how) => {
    await runTurnBeforeRestart('completed')

    const host = await relaunchAfter(how)

    expect(restartNoteIdsIn(await readAfterRestart(host))).toEqual([])
  }
)

it('delivers the note to a reader that subscribed while the restore was settling the turn', async () => {
  await runTurnBeforeRestart('running')
  const host = await relaunchAfter('crash')
  const events: AgentSessionSubscribeEvent[] = []
  const publishRestored = host['clientDelivery'].publishRestored
  // The pane subscribes the moment the session becomes readable, before the settlement lands.
  vi.spyOn(host['clientDelivery'], 'publishRestored').mockImplementation((sessionId) => {
    publishRestored(sessionId)
    host.subscribe({ id: 'pane', sessionId, emit: (event) => events.push(event) })
  })

  await host.restoreReadableSessions([SESSION])

  expect(events[0]?.type).toBe('snapshot')
  expect(restartNoteIdsIn(events.slice(0, 1))).toEqual([])
  expect(restartNoteIdsIn(events)).toHaveLength(1)
})

/** Leases a restart cannot attribute to a gone run, so it probes their owner instead. */
const PROBED_RESTARTS: [string, () => Promise<Parameters<typeof relaunchAfter>[2]>][] = [
  [
    'an older build granted without a stamp',
    async () => ({
      beforeOpen: async (directory: string) => {
        const path = agentSessionStorePath(directory)
        const persisted = JSON.parse(await readFile(path, 'utf-8'))
        delete persisted.records[SESSION].lease.ownerHostRun
        await writeFile(path, JSON.stringify(persisted))
      }
    })
  ],
  [
    'was stamped on another machine',
    async () => ({
      hostRun: { ...(await restartedAgentSessionHostRun()), machine: 'test-os:other-box' }
    })
  ],
  // The stamped pid is this test process, so it reads as still running.
  [
    'names a pid still in use',
    async () => ({
      hostRun: { ...(await restartedAgentSessionHostRun()), pid: process.pid + 1 }
    })
  ]
]

it.each(PROBED_RESTARTS)(
  'shows one restart note on a cut-off turn whose lease %s, once a probe proves it gone',
  async (_lease, restart) => {
    await runTurnBeforeRestart('running')
    const probeOwner = vi.fn(async (): Promise<AgentSessionOwnerProbe> => ({
      outcome: 'pid-absent'
    }))

    const host = await relaunchAfter('crash', { probeOwner }, await restart())

    expect(restartNoteIdsIn(await readAfterRestart(host))).toHaveLength(1)
    expect(probeOwner).toHaveBeenCalled()
  }
)
