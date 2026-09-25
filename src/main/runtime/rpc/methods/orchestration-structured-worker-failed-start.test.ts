// A chat surface gets a readable conversation when its agent fails to start; a worker launch needs a
// running agent, so its create still answers the start's refusal with the reason, after one spawn.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AgentSessionRecordStore } from '../../agent-session-record-store'
import type { StructuredAgentSessionAdapter } from '../../../native-chat/agent-session-wire/structured-agent-session-adapter'
import { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  HOST_TEST_NOW as NOW,
  hostTestAttachParams
} from '../../../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { createStructuredWorkerSession } from './orchestration-structured-worker-session'

const EXIT_REASON = 'Codex is not signed in. Run codex login'

let root: string
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-worker-failed-start-'))
  // The worker mints its operation id from `Date.now()`; the host expires ids against its own clock.
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  acquire = vi.fn(async () => {
    throw new Error(EXIT_REASON)
  })
  const store = await AgentSessionRecordStore.open({
    directory: join(root, 'store'),
    hostId: 'local'
  })
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      acquire,
      releaseAcquisition: vi.fn(async () => true),
      closeSession: vi.fn(async () => true),
      dispatch: vi.fn(async () => ({ state: 'admitted' as const })),
      cancelTurn: vi.fn(async () => ({ cancelled: true })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-1',
    now: () => NOW
  })
  setStructuredAgentSessionHost(host)
})

afterEach(async () => {
  vi.restoreAllMocks()
  setStructuredAgentSessionHost(null)
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

describe('a structured worker whose agent fails to start', () => {
  it('is refused with the start’s own reason, after one spawn and no readable chat', async () => {
    const { envelope: _envelope, ...resolved } = hostTestAttachParams(null)
    const publishStructuredAgentSessionTab = vi.fn(async () => undefined)
    const runtime = {
      ensureStructuredAgentSessionHost: async () => {},
      resolveStructuredAgentSessionCreateIntent: async () => resolved,
      publishStructuredAgentSessionTab,
      retireStructuredAgentSessionTabFromSnapshot: () => {}
    }

    await expect(
      createStructuredWorkerSession({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create path reaches only the four runtime members stubbed above; a missing one fails the call.
        runtime: runtime as unknown as OrcaRuntimeService,
        worktreeId: 'wt_1',
        agent: 'codex',
        dispatchId: 'd_failed_start',
        onJournalActivity: () => {}
      })
    ).rejects.toThrow(`The structured codex session for this worker was refused: ${EXIT_REASON}`)
    expect(acquire).toHaveBeenCalledOnce()
    expect(publishStructuredAgentSessionTab).not.toHaveBeenCalled()
    expect(host.listSessionTabs()).toEqual([])
  })
})
