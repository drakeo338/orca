// After any restart, a send brings the chat back: the previous run's owner is taken as dead without
// asking the OS, the send restarts it, and the message reaches the provider. Asserted where the
// user sees it — the send's answer, the subscriber's frames, the dispatch — not in the journal.

import { expect, it, vi } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import type {
  AgentSessionSendResult,
  AgentSessionMutationResult,
  AgentSessionSubscribeEvent
} from '../../../shared/agent-session-wire'
import { AgentSessionRecoveryCapsule } from '../../runtime/agent-session-recovery-capsule'
import { createStructuredAgentSessionOwnerProbe } from '../../runtime/structured-agent-session-owner-probe'
import { CALLER, envelope, hostTestState } from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestMessage
} from './structured-agent-session-host-test-data'
import {
  relaunchAfter,
  restartNoteIdsIn,
  runTurnBeforeRestart
} from './structured-agent-session-restart-interruption-test-harness'

const SIGN_IN_REQUIRED = 'Claude Code is not signed in. Sign in with the Claude CLI'

/** A turn cut off by `how`, relaunched, and a pane reading the chat — no hold, so only a send
 *  can bring the owner back. The host probes with the real owner probe, over OS reads that would
 *  call the old owner alive: only the previous-run rule lets a still-held lease go. */
async function relaunchedMidTurn(how: 'quit' | 'crash') {
  await runTurnBeforeRestart('running')
  const readProcess = vi.fn(async (): Promise<AgentSessionOwnerProbe> => ({
    outcome: 'identity-matched',
    matchedOn: ['process-start-time']
  }))
  const scanSpawnTokens = vi.fn(async () => [4242])
  const host = await relaunchAfter(how, {
    probeOwner: createStructuredAgentSessionOwnerProbe('local', readProcess, scanSpawnTokens),
    recoveryCapsule: new AgentSessionRecoveryCapsule(hostTestState().root)
  })
  await host.ensureReadable(SESSION)
  const frames: AgentSessionSubscribeEvent[] = []
  host.subscribe({ id: 'pane', sessionId: SESSION, emit: (frame) => frames.push(frame) })
  const { acquire, dispatch } = hostTestState()
  acquire.mockClear()
  dispatch.mockClear()
  return { host, frames, readProcess, scanSpawnTokens, acquire, dispatch }
}

function expectNoOsProbe(state: Awaited<ReturnType<typeof relaunchedMidTurn>>): void {
  expect(state.readProcess).not.toHaveBeenCalled()
  expect(state.scanSpawnTokens).not.toHaveBeenCalled()
}

function send(text: string): Promise<AgentSessionMutationResult<AgentSessionSendResult>> {
  const body = hostTestMessage(text)
  return hostTestState().host.send(CALLER, {
    envelope: envelope('agentSession.send', { body }),
    body
  })
}

function itemsIn(frames: readonly AgentSessionSubscribeEvent[]) {
  return frames.flatMap((frame) =>
    frame.type === 'snapshot' ? frame.page.items : frame.type === 'batch' ? frame.batch.items : []
  )
}

function dispatchStatesIn(
  frames: readonly AgentSessionSubscribeEvent[],
  clientMessageId: string
): string[] {
  return frames.flatMap((frame) =>
    (frame.type === 'snapshot'
      ? frame.page.submissions
      : frame.type === 'batch'
        ? frame.batch.submissions
        : []
    ).flatMap((entry) => (entry.clientMessageId === clientMessageId ? [entry.dispatchState] : []))
  )
}

function userTextIn(frames: readonly AgentSessionSubscribeEvent[]): string[] {
  return itemsIn(frames).flatMap((item) =>
    item.body.kind === 'message' && item.body.role === 'user'
      ? item.body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []))
      : []
  )
}

function statusTextIn(frames: readonly AgentSessionSubscribeEvent[]): string[] {
  return itemsIn(frames).flatMap((item) => (item.body.kind === 'status' ? [item.body.text] : []))
}

async function expectDelivered(
  state: Awaited<ReturnType<typeof relaunchedMidTurn>>,
  text: string,
  sent: AgentSessionMutationResult<AgentSessionSendResult>
): Promise<void> {
  expect(sent, JSON.stringify(sent)).toMatchObject({ ok: true, replayed: false })
  expect(state.dispatch).toHaveBeenCalledOnce()
  expect(state.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ body: hostTestMessage(text) })
  )
  await state.host.flushStreamedEvents(SESSION)
  const clientMessageId = sent.ok ? sent.value.clientMessageId : ''
  expect(dispatchStatesIn(state.frames, clientMessageId).at(-1)).toBe('accepted')
  expect(userTextIn(state.frames)).toContain(text)
  expect(restartNoteIdsIn(state.frames)).toHaveLength(1)
}

it.each(['quit', 'crash'] as const)(
  'a send after a %s mid-turn restarts the owner and delivers the message',
  async (how) => {
    const state = await relaunchedMidTurn(how)

    const sent = await send('carry on')

    await expectDelivered(state, 'carry on', sent)
    expect(state.acquire).toHaveBeenCalledOnce()
    expectNoOsProbe(state)
  }
)

it('a send after a failed restart resume restarts the owner and delivers the message', async () => {
  const state = await relaunchedMidTurn('quit')
  await state.host.restartResume.list()
  state.acquire.mockRejectedValueOnce(new Error('provider could not reconnect'))
  await state.host.restartResume.resume([SESSION], 'modal')
  expect(await state.host.restartResume.listFailures()).toMatchObject([{ sessionId: SESSION }])
  expect(state.acquire).toHaveBeenCalledOnce()

  const sent = await send('try again')

  await expectDelivered(state, 'try again', sent)
  expect(state.acquire).toHaveBeenCalledTimes(2)
  expectNoOsProbe(state)
})

it('a second send after a restart that failed to start is a fresh attempt and delivers', async () => {
  const state = await relaunchedMidTurn('quit')
  state.acquire.mockRejectedValueOnce(new Error(SIGN_IN_REQUIRED))

  const refused = await send('hello?')

  // The chat says why, and nothing latches: the next send starts over.
  expect(refused).toMatchObject({
    ok: false,
    refusal: { code: 'agent_session_owner_restart_failed' }
  })
  expect(state.dispatch).not.toHaveBeenCalled()
  await state.host.flushStreamedEvents(SESSION)
  expect(statusTextIn(state.frames).some((text) => text.includes(SIGN_IN_REQUIRED))).toBe(true)

  const sent = await send('signed in now')

  await expectDelivered(state, 'signed in now', sent)
  expect(state.acquire).toHaveBeenCalledTimes(2)
  expectNoOsProbe(state)
})
