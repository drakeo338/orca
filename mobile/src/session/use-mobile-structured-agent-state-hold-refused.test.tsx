// A hold the host refuses still leaves the chat readable: the refusal's reason is a row in it.

import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentState } from './use-mobile-structured-agent-state'

const FAILURE_ROW =
  'The provider stopped before it finished starting: Claude Code is not signed in.'

let unmount: (() => void) | null = null

afterEach(() => {
  act(() => unmount?.())
  unmount = null
})

function snapshotWithFailureRow(): AgentSessionSubscribeEvent {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: 3,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: 3,
      direction: 'tail',
      items: [
        {
          itemId: 'failed-restart',
          revision: 1,
          sequence: 1,
          observedAt: 10,
          body: { kind: 'status', text: FAILURE_ROW, tone: 'error' }
        }
      ],
      removedItemIds: [],
      submissions: [],
      window: {
        oldest: { epoch: 'epoch-1', sequence: 1 },
        newest: { epoch: 'epoch-1', sequence: 1 },
        nextCursor: { epoch: 'epoch-1', sequence: 2 }
      },
      liveCursor: { epoch: 'epoch-1', sequence: 1 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

it('subscribes and shows the chat after the host refuses the hold', async () => {
  let listener: ((value: unknown) => void) | null = null
  const client: RpcClient = {
    sendRequest: vi.fn(async () => ({
      id: 'hold-1',
      ok: false as const,
      error: { code: 'agent_session_operation_invalid', message: 'Claude Code is not signed in' },
      _meta: { runtimeId: 'runtime-1' }
    })),
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
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let state: ReturnType<typeof useMobileStructuredAgentState>['state'] | null = null
  function Harness(): null {
    state = useMobileStructuredAgentState({
      client,
      sessionId: 'session-1',
      sessionKey: 'host-a\0session-1',
      enabled: true,
      connected: true
    }).state
    return null
  }

  await act(async () => {
    const renderer = create(createElement(Harness))
    unmount = () => renderer.unmount()
  })
  await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
  act(() => listener?.(snapshotWithFailureRow()))

  expect(state).toMatchObject({
    status: 'ready',
    error: undefined,
    items: [{ body: { kind: 'status', text: FAILURE_ROW, tone: 'error' } }]
  })
})
