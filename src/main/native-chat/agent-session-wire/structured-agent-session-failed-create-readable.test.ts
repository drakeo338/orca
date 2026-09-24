// A create whose child dies while being acquired still made its conversation. The create answers it
// as a readable chat that says why the agent stopped, and a send restarts the agent through the
// host's ensure-owner step and delivers — the same path as any chat whose child ended.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult
} from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import {
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionAcquisitionRefusal,
  type StructuredAgentSessionAdapter
} from './structured-agent-session-adapter'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
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
const EXIT_REASON = 'Claude Code is not signed in. Sign in with the Claude CLI'
const STARTUP_ROW = `The provider stopped before it finished starting: ${EXIT_REASON}.`

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>
let dispatch: Mock<StructuredAgentSessionAdapter['dispatch']>
let supported = true

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-failed-create-readable-'))
  resetHostTestOperationIds()
  supported = true
  acquire = vi.fn(async ({ fence, spawnToken }) => ({
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
    link: {
      linkId: `link-${fence}`,
      handle: { provider: 'codex', threadId: THREAD },
      origin: 'created' as const,
      mintedAtFence: fence,
      observedAt: NOW
    }
  }))
  dispatch = vi.fn(async () => ({ state: 'admitted' as const }))
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  let spawns = 0
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      supportsCreate: () => supported,
      acquire,
      releaseAcquisition: vi.fn(async () => true),
      closeSession: vi.fn(async () => true),
      dispatch,
      cancelTurn: vi.fn(async () => ({ cancelled: true })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => `spawn-${++spawns}`,
    now: () => NOW
  })
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

function statusRows(created: AgentSessionMutationResult<AgentSessionAttachResult>): string[] {
  return created.ok
    ? created.value.page.items.flatMap((item) =>
        item.body.kind === 'status' ? [item.body.text] : []
      )
    : []
}

function send(text: string, fence: number) {
  const body = hostTestMessage(text)
  return host.send(CALLER, {
    envelope: {
      sessionId: SESSION,
      clientOperationId: hostTestOperationId(),
      expectedRuntimeFence: fence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: SESSION,
        fields: { body }
      })
    },
    body
  })
}

describe('a create whose child dies while being acquired', () => {
  it('answers the conversation, with the cause in it, and a send restarts the agent and delivers', async () => {
    acquire.mockRejectedValueOnce(new Error(EXIT_REASON))
    const params = hostTestAttachParams(null)

    const created = await host.create(CALLER, params)

    expect(created).toMatchObject({ ok: true, value: { sessionId: SESSION } })
    expect(statusRows(created)).toEqual([STARTUP_ROW])
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
    expect(host.listSessionTabs()).toEqual([
      { sessionId: SESSION, workspaceId: 'workspace-1', agent: 'codex' }
    ])
    // A lost reply's replay answers the same conversation and writes no second row.
    const replayed = await host.create(CALLER, params)
    expect(replayed).toMatchObject({ ok: true, fence: created.ok ? created.fence : -1 })
    expect(statusRows(replayed)).toEqual([STARTUP_ROW])
    expect(acquire).toHaveBeenCalledOnce()

    const sent = await send('hello', created.ok ? created.fence : -1)

    expect(sent).toMatchObject({ ok: true, value: { submission: { dispatchState: 'pending' } } })
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('live')
  })

  it('keeps a sign-in failure retryable by sending, and delivers once the user has signed in', async () => {
    acquire.mockRejectedValueOnce(new AgentSessionAcquisitionRefusal(EXIT_REASON))
    const created = await host.create(CALLER, hostTestAttachParams(null))
    expect(statusRows(created)).toEqual([STARTUP_ROW])
    const fence = created.ok ? created.fence : -1

    // Still signed out: the restart fails with its cause, and nothing is admitted.
    acquire.mockRejectedValueOnce(new AgentSessionAcquisitionRefusal(EXIT_REASON))
    await expect(send('are you there?', fence)).resolves.toMatchObject({
      ok: false,
      refusal: {
        code: 'agent_session_owner_restart_failed',
        message: expect.stringContaining(EXIT_REASON)
      }
    })
    expect(dispatch).not.toHaveBeenCalled()

    // Signed in: the same kind of send restarts the agent and delivers.
    const sent = await send(
      'are you there now?',
      store.getRecord(SESSION)?.lease.runtimeFence ?? -1
    )
    expect(sent).toMatchObject({ ok: true })
    expect(acquire).toHaveBeenCalledTimes(3)
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('leaves an unverifiable exit unknown rather than claiming a readable chat', async () => {
    acquire.mockRejectedValueOnce(new AgentSessionAcquisitionExitUnprovenError(new Error('hung')))

    await expect(host.create(CALLER, hostTestAttachParams(null))).rejects.toThrow()
    expect(host.hasSession(SESSION)).toBe(false)
  })
})

describe('a create refused before its reservation', () => {
  it('stays a refusal with no conversation, so the client offers a fresh create', async () => {
    supported = false

    await expect(host.create(CALLER, hostTestAttachParams(null))).resolves.toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: 'structured_agent_session_unsupported' })
    })
    expect(store.getRecord(SESSION)).toBeNull()
    expect(host.hasSession(SESSION)).toBe(false)

    supported = true
    await expect(host.create(CALLER, hostTestAttachParams(null))).resolves.toMatchObject({
      ok: true
    })
    expect(acquire).toHaveBeenCalledOnce()
  })
})
