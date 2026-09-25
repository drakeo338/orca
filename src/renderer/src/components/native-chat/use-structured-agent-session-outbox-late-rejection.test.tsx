// @vitest-environment happy-dom

// A send the host answered `pending` can still be rejected later, when the child holding it is
// stopped before it ever wrote it. The chat must treat that exactly like a send rejected on the
// spot: the reason on screen, the queue stopped on it, and Retry sending it under a new id.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalSubmission } from '../../../../shared/agent-session-journal-types'
import { DISPATCH_REJECTED_CANCELLED } from '../../../../shared/structured-agent-session-dispatch-rejection'

const mocks = vi.hoisted(() => ({
  call: vi.fn<(target: unknown, method: string, params: SendParams) => Promise<unknown>>()
}))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import { useStructuredAgentSessionOutbox } from './use-structured-agent-session-outbox'

const LOCAL_TARGET = { kind: 'local' } as const
const REASON = 'Claude never finished starting, so Orca stopped it. Your message was not sent.'

type SendParams = { envelope: { clientOperationId: string }; retryUnknown?: true }

function submission(
  clientMessageId: string,
  dispatchState: AgentJournalSubmission['dispatchState'],
  reason: string | null = null
): AgentJournalSubmission {
  return {
    clientMessageId,
    fence: 1,
    payloadFingerprint: 'fingerprint',
    dispatchState,
    providerItemId: null,
    reason,
    submittedAt: 10,
    resolvedAt: dispatchState === 'pending' ? null : 11
  }
}

function sendResult(
  clientMessageId: string,
  dispatchState: AgentJournalSubmission['dispatchState'],
  reason: string | null = null
) {
  return {
    ok: true,
    replayed: false,
    fence: 1,
    cursor: { epoch: 'epoch-1', sequence: 10 },
    value: { clientMessageId, submission: submission(clientMessageId, dispatchState, reason) }
  }
}

function answerEach(dispatchState: AgentJournalSubmission['dispatchState'], reason?: string) {
  mocks.call.mockImplementation(async (_target, _method, params) =>
    sendResult(params.envelope.clientOperationId, dispatchState, reason ?? null)
  )
}

function sentIds(): string[] {
  return mocks.call.mock.calls.map(([, , params]) => params.envelope.clientOperationId)
}

function renderOutbox(submissions: readonly AgentJournalSubmission[] = []) {
  return renderHook(
    (props: { submissions: readonly AgentJournalSubmission[] }) =>
      useStructuredAgentSessionOutbox({
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        fence: 1,
        submissions: props.submissions
      }),
    { initialProps: { submissions } }
  )
}

/** Lets the drain and the probe timer run, so "nothing was sent" means nothing would be. */
async function settleEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

describe('a send the host rejects after answering pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('shows the reason and blocks on it while the chat is open, and Retry sends it fresh', async () => {
    answerEach('pending')
    const { result, rerender } = renderOutbox()
    act(() => expect(result.current.send('held while starting')).toBe(true))
    await waitFor(() => expect(result.current.outbox[0]?.state).toBe('dispatching'))
    const id = result.current.outbox[0]!.clientMessageId

    rerender({ submissions: [submission(id, 'rejected', REASON)] })

    await waitFor(() => expect(result.current.error).toBe(REASON))
    expect(result.current.outbox[0]).toMatchObject({ clientMessageId: id, state: 'queued' })
    expect(result.current.blockedClientMessageId).toBe(id)
    await settleEffects()
    expect(mocks.call).toHaveBeenCalledOnce()

    answerEach('accepted')
    act(() => result.current.retry(id))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    expect(sentIds()[1]).not.toBe(id)
    expect(mocks.call.mock.calls[1]![2].retryUnknown).toBeUndefined()
    expect(result.current.error).toBeNull()
  })

  it('shows the reason when the chat reopens with the rejection already recorded', async () => {
    answerEach('pending')
    const first = renderOutbox()
    act(() => expect(first.result.current.send('held while starting')).toBe(true))
    await waitFor(() => expect(first.result.current.outbox[0]?.state).toBe('dispatching'))
    const id = first.result.current.outbox[0]!.clientMessageId
    first.unmount()

    const reopened = renderOutbox([submission(id, 'rejected', REASON)])

    await waitFor(() => expect(reopened.result.current.error).toBe(REASON))
    expect(reopened.result.current.outbox[0]).toMatchObject({
      clientMessageId: id,
      state: 'queued'
    })
    expect(reopened.result.current.blockedClientMessageId).toBe(id)
    await settleEffects()
    expect(mocks.call).toHaveBeenCalledOnce()
  })

  it('takes the journal answer over a send result that arrives after it', async () => {
    let answer: (value: unknown) => void = () => {}
    mocks.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const { result, rerender } = renderOutbox()
    act(() => expect(result.current.send('held while starting')).toBe(true))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledOnce())
    const id = sentIds()[0]!

    rerender({ submissions: [submission(id, 'rejected', REASON)] })
    await waitFor(() => expect(result.current.error).toBe(REASON))
    await act(async () => answer(sendResult(id, 'pending')))
    await settleEffects()

    expect(result.current.error).toBe(REASON)
    expect(result.current.outbox[0]).toMatchObject({ clientMessageId: id, state: 'queued' })
    expect(result.current.blockedClientMessageId).toBe(id)
  })

  it('handles a rejection answered on the spot once, even when the journal repeats it', async () => {
    answerEach('rejected', REASON)
    const { result, rerender } = renderOutbox()
    act(() => expect(result.current.send('refused')).toBe(true))
    await waitFor(() => expect(result.current.error).toBe(REASON))
    const id = result.current.outbox[0]!.clientMessageId

    rerender({ submissions: [submission(id, 'rejected', REASON)] })
    await settleEffects()
    expect(result.current.blockedClientMessageId).toBe(id)
    expect(mocks.call).toHaveBeenCalledOnce()

    answerEach('accepted')
    act(() => result.current.retry(id))
    await waitFor(() => expect(result.current.outbox).toHaveLength(0))
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(sentIds()[1]).not.toBe(id)
  })

  it('keeps the reason when a send still in flight answers after another entry is rejected', async () => {
    answerEach('pending')
    const { result, rerender } = renderOutbox()
    act(() => expect(result.current.send('held while starting')).toBe(true))
    await waitFor(() => expect(result.current.outbox[0]?.state).toBe('dispatching'))
    const heldId = result.current.outbox[0]!.clientMessageId
    let answer: (value: unknown) => void = () => {}
    mocks.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    act(() => expect(result.current.send('sent behind it')).toBe(true))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    const inFlightId = sentIds()[1]!

    rerender({ submissions: [submission(heldId, 'rejected', REASON)] })
    await waitFor(() => expect(result.current.error).toBe(REASON))
    await act(async () => answer(sendResult(inFlightId, 'pending')))
    await settleEffects()

    expect(result.current.error).toBe(REASON)
    expect(result.current.blockedClientMessageId).toBe(heldId)
  })

  it('drops a send the user cancelled, with nothing on screen', async () => {
    answerEach('pending')
    const { result, rerender } = renderOutbox()
    act(() => expect(result.current.send('never mind')).toBe(true))
    await waitFor(() => expect(result.current.outbox[0]?.state).toBe('dispatching'))
    const id = result.current.outbox[0]!.clientMessageId

    rerender({ submissions: [submission(id, 'rejected', DISPATCH_REJECTED_CANCELLED)] })

    await waitFor(() => expect(result.current.outbox).toHaveLength(0))
    expect(result.current.error).toBeNull()
    expect(result.current.blockedClientMessageId).toBeNull()
  })
})
