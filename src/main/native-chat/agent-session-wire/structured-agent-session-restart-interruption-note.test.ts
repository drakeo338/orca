// The note a cut-off turn gets when Orca itself went away, asserted where clients read it: the
// subscribe snapshot and live batches, not the journal file.

import { expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
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
