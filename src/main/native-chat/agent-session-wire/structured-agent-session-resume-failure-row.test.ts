// A restart that fails is written into the chat by the resume every asker shares — a surface hold,
// a send, provider-exit recovery — as one error row per attempt, carrying the restart's own cause,
// delivered to whoever has the chat open. Against the real host.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionSubscribeEvent
} from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { providerStartupFailureOutcome } from './structured-agent-session-dead-generation-settlement'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { recordStructuredAgentSessionStartFailure } from './structured-agent-session-start-failure-row'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  hostTestMessage,
  hostTestOperationId,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'

const CALLER = { callerKey: 'client-1' }
const CAUSE = 'Claude Code is not signed in. Sign in with the Claude CLI'
const ROW_TEXT = `The provider stopped before it finished starting: ${CAUSE}.`

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>
let generation: number

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-resume-failure-row-'))
  resetHostTestOperationIds()
  generation = 0
  acquire = vi.fn(async ({ fence, spawnToken }) => ({
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
    acquisitionGeneration: `generation-${++generation}`,
    link: {
      linkId: `link-${fence}`,
      handle: { provider: 'codex' as const, threadId: THREAD },
      origin: store.getRecord(SESSION)?.providerHandleChain.length
        ? ('resumed' as const)
        : ('created' as const),
      mintedAtFence: fence,
      observedAt: NOW
    }
  }))
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      acquire,
      dispatch: vi.fn(async () => ({ state: 'admitted' as const })),
      closeSession: vi.fn(async () => true),
      // A failed acquisition is proven gone, as the real adapters prove it.
      releaseAcquisition: vi.fn(async () => true),
      cancelTurn: vi.fn(async () => ({ cancelled: false })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => `spawn-${acquire.mock.calls.length}`,
    releaseGraceMs: 60_000,
    now: () => NOW,
    onEventSinkError: () => undefined
  })
  expect(await host.attach(CALLER, hostTestAttachParams(null))).toMatchObject({ ok: true })
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

/** The chat is open but its child is gone, as after the idle release: readable, no owner. */
async function openChatWithoutChild(): Promise<AgentSessionSubscribeEvent[]> {
  await host.close(SESSION)
  await host.restoreReadableSessions([SESSION])
  const events: AgentSessionSubscribeEvent[] = []
  host.subscribe({ id: 'chat', sessionId: SESSION, emit: (event) => events.push(event) })
  acquire.mockClear()
  return events
}

/** A chat pane coming into view, as the hold RPC asks for it. */
function viewHold(): Promise<void> {
  return host.hold(SESSION, 'pane', { resumeFailedStart: false })
}

/** The error rows a subscriber was sent, once each, in the order it saw them. */
function deliveredErrorRows(events: AgentSessionSubscribeEvent[]): AgentJournalRenderItem[] {
  const rows = new Map<string, AgentJournalRenderItem>()
  for (const event of events) {
    const items =
      event.type === 'batch'
        ? event.batch.items
        : event.type === 'snapshot' || event.type === 'reset'
          ? event.page.items
          : []
    for (const item of items) {
      if (item.body.kind === 'status' && item.body.tone === 'error') {
        rows.set(item.itemId, item)
      }
    }
  }
  return [...rows.values()]
}

function journalErrorRows(): AgentJournalRenderItem[] {
  return host
    .journalSnapshot(SESSION)
    .items.filter((item) => item.body.kind === 'status' && item.body.tone === 'error')
}

function sendParams(text: string) {
  const body = hostTestMessage(text)
  const envelope: AgentSessionMutationEnvelope = {
    sessionId: SESSION,
    clientOperationId: hostTestOperationId(),
    expectedRuntimeFence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method: 'agentSession.send',
      sessionId: SESSION,
      fields: { body }
    })
  }
  return { envelope, body }
}

describe('a restart that dies before it publishes', () => {
  it('tells the open chat why when a surface hold asked for it, and answers the hold with the cause', async () => {
    const events = await openChatWithoutChild()
    acquire.mockRejectedValue(new Error(CAUSE))

    await expect(viewHold()).rejects.toMatchObject({
      message: 'agent_session_operation_invalid',
      refusal: { code: 'agent_session_operation_invalid', message: CAUSE }
    })

    expect(acquire).toHaveBeenCalledOnce()
    expect(deliveredErrorRows(events).map((item) => item.body)).toEqual([
      { kind: 'status', text: ROW_TEXT, tone: 'error' }
    ])
  })

  it('writes the same row whether a hold, a send or provider-exit recovery asked', async () => {
    await openChatWithoutChild()
    const spawnChild = acquire.getMockImplementation()!
    acquire.mockRejectedValue(new Error(CAUSE))

    await expect(viewHold()).rejects.toThrow()
    await expect(host.send(CALLER, sendParams('while signed out'))).resolves.toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_owner_restart_failed' }
    })

    // Signed in: a send brings a child that runs; it is lost mid-conversation under the open
    // pane, and provider-exit recovery's restart meets the same failure.
    acquire.mockImplementationOnce(spawnChild)
    await expect(host.send(CALLER, sendParams('signed in'))).resolves.toMatchObject({ ok: true })
    await viewHold()
    await host.handleAdapterEvent({
      type: 'ended',
      sessionId: SESSION,
      fence: store.getRecord(SESSION)!.lease.runtimeFence,
      acquisitionGeneration: `generation-${generation}`,
      reason: 'killed',
      cause: 'unexpected-exit'
    })

    expect(acquire).toHaveBeenCalledTimes(4)
    const rows = journalErrorRows()
    expect(rows.map((item) => item.body)).toEqual([
      { kind: 'status', text: ROW_TEXT, tone: 'error' },
      { kind: 'status', text: ROW_TEXT, tone: 'error' },
      { kind: 'status', text: ROW_TEXT, tone: 'error' }
    ])
    expect(new Set(rows.map((item) => item.itemId)).size).toBe(3)
  })

  it('is not restarted again by a surface that comes back; the next send retries', async () => {
    const events = await openChatWithoutChild()
    acquire.mockRejectedValue(new Error(CAUSE))
    await expect(viewHold()).rejects.toThrow()

    // The pane unmounts and remounts, twice: it holds the chat, and spawns nothing.
    await viewHold()
    host.release(SESSION, 'pane')
    await viewHold()
    expect(acquire).toHaveBeenCalledOnce()
    expect(deliveredErrorRows(events)).toHaveLength(1)

    await expect(host.send(CALLER, sendParams('signed in now?'))).resolves.toMatchObject({
      ok: false
    })
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(deliveredErrorRows(events)).toHaveLength(2)
  })

  it('is restarted by an explicit retry that reattaches through a hold', async () => {
    await openChatWithoutChild()
    const spawnChild = acquire.getMockImplementation()!
    acquire.mockRejectedValueOnce(new Error(CAUSE))
    await expect(viewHold()).rejects.toThrow()
    acquire.mockImplementationOnce(spawnChild)

    await host.hold(SESSION, 'restart-retry')

    expect(acquire).toHaveBeenCalledTimes(2)
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('live')
  })
})

describe('a restart whose child is published and then dies starting', () => {
  it('is not restarted again by a surface that comes back', async () => {
    const events = await openChatWithoutChild()
    // Published before it proves its start, as a Claude child is.
    const spawnChild = acquire.getMockImplementation()!
    acquire.mockImplementationOnce(async (input) => ({
      ...(await spawnChild(input)),
      providerChildPhase: 'starting' as const
    }))
    await viewHold()
    const lease = store.getRecord(SESSION)!.lease
    await host.handleAdapterEvent({
      type: 'ended',
      sessionId: SESSION,
      fence: lease.runtimeFence,
      acquisitionGeneration: `generation-${generation}`,
      reason: CAUSE,
      cause: 'unexpected-exit',
      startupUnproven: true
    })
    host.release(SESSION, 'pane')

    await viewHold()

    expect(acquire).toHaveBeenCalledOnce()
    expect(deliveredErrorRows(events).map((item) => item.body)).toEqual([
      { kind: 'status', text: ROW_TEXT, tone: 'error' }
    ])
  })
})

describe('a chat whose create made the conversation but not its agent', () => {
  it('is not started by the pane that opens it; the first send starts it', async () => {
    // A failed create answers a readable chat whose first row is the start failure.
    const events = await openChatWithoutChild()
    await recordStructuredAgentSessionStartFailure(
      {
        sessions: host['sessions'],
        restoreReadable: (id) => host['restore'].restoreReadableUnderSerialize(id),
        publish: (id, journal) => host['subscribers'].publish(id, journal)
      },
      SESSION,
      'failed-start:create',
      providerStartupFailureOutcome(CAUSE)
    )

    await viewHold()
    expect(acquire).not.toHaveBeenCalled()
    expect(deliveredErrorRows(events).map((item) => item.body)).toEqual([
      { kind: 'status', text: ROW_TEXT, tone: 'error' }
    ])

    await expect(host.send(CALLER, sendParams('hello'))).resolves.toMatchObject({ ok: true })
    expect(acquire).toHaveBeenCalledOnce()
  })
})

describe('a chat this host cannot run', () => {
  it('says so once, not once per view', async () => {
    const events = await openChatWithoutChild()
    host.deps.adapter.supportsLocation = () => false

    await expect(viewHold()).rejects.toThrow('structured_agent_session_unsupported')
    await viewHold()

    expect(deliveredErrorRows(events)).toHaveLength(1)
  })
})
