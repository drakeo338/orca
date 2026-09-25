// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionState } from '../../../../shared/structured-agent-session-reducer'

const mocks = vi.hoisted(() => ({
  call: vi.fn<(target: unknown, method: string, params: unknown) => Promise<unknown>>()
}))

let readState: StructuredAgentSessionState

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

vi.mock('./use-structured-agent-session-hold', () => ({
  useStructuredAgentSessionHold: () => undefined
}))

vi.mock('./use-structured-agent-session-read', () => ({
  useStructuredAgentSessionRead: () => ({
    state: readState,
    loadingOlder: false,
    loadOlder: vi.fn<() => Promise<void>>()
  })
}))

vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: vi.fn<(target: unknown, mutation: unknown) => Promise<void>>()
}))

import { useStructuredAgentSession } from './use-structured-agent-session'
import { whenStructuredAgentSessionOptionPicksSettled } from '@/lib/structured-agent-session-held-option-picks'

const LOCAL_TARGET = { kind: 'local' } as const

const HOST_CATALOG = {
  origin: 'live-session',
  models: [
    { id: 'gpt-default', label: 'GPT Default', isDefault: true, efforts: [] },
    {
      id: 'gpt-picked',
      label: 'GPT Picked',
      efforts: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' }
      ]
    }
  ],
  fetchedAt: 1
}

function sessionState(fence: number | null): StructuredAgentSessionState {
  return {
    epoch: 'epoch-1',
    cursor: null,
    fence,
    items: [],
    submissions: [],
    retainedItemLimit: 1_024,
    hasOlder: false,
    status: 'ready',
    handoff: null,
    commands: []
  }
}

function mutationMethods(): string[] {
  return mocks.call.mock.calls
    .map(([, method]) => method)
    .filter((method) => method === 'agentSession.setOption' || method === 'agentSession.send')
}

describe('a pick and a first message made while the chat launches', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.call.mockReset()
    mocks.call.mockImplementation(async (_target, method, params) => {
      if (method === 'agentSession.modelCatalog') {
        return HOST_CATALOG
      }
      if (method === 'agentSession.setOption') {
        return { ok: true, value: { key: 'model', value: 'gpt-picked' } }
      }
      if (method === 'agentSession.send') {
        const clientMessageId =
          typeof params === 'object' && params !== null && 'clientMessageId' in params
            ? params.clientMessageId
            : undefined
        return { ok: true, value: { submission: { clientMessageId, dispatchState: 'accepted' } } }
      }
      return new Promise(() => {})
    })
  })

  it('reaches the host as setOption before the send, so the first turn runs the pick', async () => {
    readState = sessionState(null)
    const { result, rerender } = renderHook(
      ({ transportEnabled }: { transportEnabled: boolean }) =>
        useStructuredAgentSession({
          sessionId: 'session-1',
          target: LOCAL_TARGET,
          agent: 'codex',
          isVisible: true,
          transportEnabled,
          launch: 'new'
        }),
      { initialProps: { transportEnabled: false } }
    )
    await waitFor(() => expect(mocks.call).toHaveBeenCalled())
    await act(async () => {
      expect(await result.current.setStructuredOption('model', 'gpt-picked')).toBe(true)
    })
    act(() => {
      expect(result.current.send('first message')).toBe(true)
    })
    expect(mutationMethods()).toEqual([])

    // Publish and attach land together; the host serializes mutations in arrival order.
    readState = sessionState(3)
    rerender({ transportEnabled: true })
    await waitFor(() => expect(mutationMethods()).toHaveLength(2))
    expect(mutationMethods()).toEqual(['agentSession.setOption', 'agentSession.send'])
  })

  it('sends the first message only after every held pick has settled', async () => {
    const settle: (() => void)[] = []
    const defaultCall = mocks.call.getMockImplementation()
    mocks.call.mockImplementation((target, method, params) =>
      method === 'agentSession.setOption'
        ? new Promise((resolve) => {
            settle.push(() => resolve({ ok: true, value: {} }))
          })
        : defaultCall!(target, method, params)
    )
    readState = sessionState(null)
    const { result, rerender } = renderHook(
      ({ transportEnabled }: { transportEnabled: boolean }) =>
        useStructuredAgentSession({
          sessionId: 'session-1',
          target: LOCAL_TARGET,
          agent: 'codex',
          isVisible: true,
          transportEnabled,
          launch: 'new'
        }),
      { initialProps: { transportEnabled: false } }
    )
    await waitFor(() => expect(mocks.call).toHaveBeenCalled())
    await act(async () => {
      expect(await result.current.setStructuredOption('model', 'gpt-picked')).toBe(true)
    })
    await act(async () => {
      expect(await result.current.setStructuredOption('effort', 'high')).toBe(true)
    })
    act(() => {
      expect(result.current.send('first message')).toBe(true)
    })
    // A launch prompt sends outside this outbox; it waits on the same held picks.
    let launchPromptReleased = false
    void whenStructuredAgentSessionOptionPicksSettled('session-1').then(() => {
      launchPromptReleased = true
    })

    readState = sessionState(3)
    rerender({ transportEnabled: true })
    await waitFor(() => expect(settle).toHaveLength(1))
    // Held picks flush one at a time; the queued message must not slip in between them.
    await act(async () => settle[0]!())
    await waitFor(() => expect(settle).toHaveLength(2))
    expect(mutationMethods()).toEqual(['agentSession.setOption', 'agentSession.setOption'])
    expect(launchPromptReleased).toBe(false)
    await act(async () => settle[1]!())
    await waitFor(() => expect(mutationMethods()).toHaveLength(3))
    expect(launchPromptReleased).toBe(true)
    expect(mutationMethods()).toEqual([
      'agentSession.setOption',
      'agentSession.setOption',
      'agentSession.send'
    ])
  })
})
