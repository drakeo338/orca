// A send the host answered `pending` can still be rejected later, when the child holding it is
// stopped before it ever wrote it. Mobile has no outbox, so it must say so the way it says an
// immediate rejection, once, and a resend of the same text must be a new message.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalSubmission } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import { DISPATCH_REJECTED_CANCELLED } from '../../../src/shared/structured-agent-session-dispatch-rejection'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileStructuredSendOperationJournalForTests } from './mobile-structured-send-operation-journal'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))

const REASON = 'Claude never finished starting, so Orca stopped it. Your message was not sent.'

type SendParams = { envelope: { clientOperationId: string; payloadFingerprint: string } }

function ok(result: unknown) {
  return { id: 'rpc-1', ok: true as const, result, _meta: { runtimeId: 'runtime-1' } }
}

function isSendParams(value: unknown): value is SendParams {
  return typeof value === 'object' && value !== null && 'envelope' in value
}

function submission(
  params: SendParams,
  dispatchState: AgentJournalSubmission['dispatchState'],
  reason: string | null = null
): AgentJournalSubmission {
  return {
    clientMessageId: params.envelope.clientOperationId,
    fence: 3,
    payloadFingerprint: params.envelope.payloadFingerprint,
    dispatchState,
    providerItemId: null,
    reason,
    submittedAt: 10,
    resolvedAt: dispatchState === 'pending' ? null : 11
  }
}

function sendResult(params: SendParams, dispatchState: AgentJournalSubmission['dispatchState']) {
  const row = submission(params, dispatchState, dispatchState === 'rejected' ? REASON : null)
  return ok({
    ok: true,
    replayed: false,
    fence: 3,
    cursor: { epoch: 'epoch-1', sequence: 1 },
    value: { clientMessageId: row.clientMessageId, submission: row }
  })
}

function snapshotEvent(submissions: AgentJournalSubmission[] = []): AgentSessionSubscribeEvent {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: 3,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: 3,
      direction: 'tail',
      items: [],
      removedItemIds: [],
      submissions,
      window: { oldest: null, newest: null, nextCursor: { epoch: 'epoch-1', sequence: 0 } },
      liveCursor: { epoch: 'epoch-1', sequence: 0 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

describe('a mobile send the host rejects after answering pending', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  let storedOperations: Map<string, string>
  const onSendError = vi.fn()
  const sendRequest = vi.fn<RpcClient['sendRequest']>()
  const client: RpcClient = {
    sendRequest,
    subscribe: (_method, _params, onData) => {
      listener = onData
      return () => {}
    },
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }

  function Harness(): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent: 'claude',
      onSendError
    })
    return null
  }

  async function mountSession(): Promise<void> {
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotEvent()))
  }

  function sends(): SendParams[] {
    return sendRequest.mock.calls.flatMap(([method, params]) =>
      method === 'agentSession.send' && isSendParams(params) ? [params] : []
    )
  }

  function answerSends(
    answer: (params: SendParams) => ReturnType<typeof ok> | Promise<ReturnType<typeof ok>>
  ): void {
    sendRequest.mockImplementation(async (method, params) => {
      if (method !== 'agentSession.send' || !isSendParams(params)) {
        return method === 'agentSession.options' ? ok({ models: [], current: {} }) : ok({})
      }
      return answer(params)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetMobileStructuredSendOperationJournalForTests()
    storedOperations = new Map()
    asyncStorage.getItem.mockImplementation(
      async (key: string) => storedOperations.get(key) ?? null
    )
    asyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      storedOperations.set(key, value)
    })
    asyncStorage.removeItem.mockImplementation(async (key: string) => {
      storedOperations.delete(key)
    })
    answerSends((params) => sendResult(params, 'pending'))
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    listener = null
  })

  it('shows the reason once, and a resend of the same text is a new message', async () => {
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('held while starting')).toBe('accepted')
    })
    const first = sends()[0]!

    act(() => listener?.(snapshotEvent([submission(first, 'rejected', REASON)])))
    act(() => listener?.(snapshotEvent([submission(first, 'rejected', REASON)])))

    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith(REASON)
    await act(async () => {
      expect(await hook!.sendWithOutcome('held while starting')).toBe('accepted')
    })
    expect(sends()[1]!.envelope.clientOperationId).not.toBe(first.envelope.clientOperationId)
  })

  it('shows the reason when the stream rejects the send before its answer arrives', async () => {
    await mountSession()
    let answer: () => void = () => {}
    answerSends(
      (params) =>
        new Promise((resolve) => {
          answer = () => resolve(sendResult(params, 'pending'))
        })
    )
    let sent: Promise<unknown> = Promise.resolve()
    act(() => {
      sent = hook!.sendWithOutcome('held while starting')
    })
    await vi.waitFor(() => expect(sends()).toHaveLength(1))

    act(() => listener?.(snapshotEvent([submission(sends()[0]!, 'rejected', REASON)])))
    expect(onSendError).not.toHaveBeenCalled()
    await act(async () => {
      answer()
      await sent
    })

    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith(REASON)
  })

  it('reports a rejection answered on the spot once, even when the stream repeats it', async () => {
    answerSends((params) => sendResult(params, 'rejected'))
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('refused')).toBe('rejected')
    })

    act(() => listener?.(snapshotEvent([submission(sends()[0]!, 'rejected', REASON)])))

    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith(REASON)
  })

  it('stays quiet for a send the user cancelled and for one the provider took', async () => {
    await mountSession()
    await act(async () => {
      await hook!.sendWithOutcome('never mind')
      await hook!.sendWithOutcome('answered')
    })
    const [cancelled, taken] = sends()

    act(() =>
      listener?.(
        snapshotEvent([
          submission(cancelled!, 'rejected', DISPATCH_REJECTED_CANCELLED),
          submission(taken!, 'accepted')
        ])
      )
    )

    expect(onSendError).not.toHaveBeenCalled()
  })
})
