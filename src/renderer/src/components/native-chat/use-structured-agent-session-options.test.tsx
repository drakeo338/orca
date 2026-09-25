// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ call: vi.fn(), enqueue: vi.fn() }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: mocks.enqueue
}))

import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useStructuredAgentSessionOptions } from './use-structured-agent-session-options'

const LOCAL_TARGET = { kind: 'local' } as const

class FakeRpcCallError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

type Answers = {
  options?: () => Promise<unknown>
  modelCatalog?: () => Promise<unknown>
}

function answer(answers: Answers): void {
  mocks.call.mockImplementation((_target: unknown, method: string) => {
    if (method === 'agentSession.options' && answers.options) {
      return answers.options()
    }
    if (method === 'agentSession.modelCatalog' && answers.modelCatalog) {
      return answers.modelCatalog()
    }
    return new Promise(() => {})
  })
}

type MutateCall = (...args: unknown[]) => Promise<unknown>

function mutateWith(reply: MutateCall): {
  mutate: StructuredAgentSessionMutate
  calls: ReturnType<typeof vi.fn<MutateCall>>
} {
  const calls = vi.fn<MutateCall>(reply)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each reply is null or the AgentSessionOptionResult shape the hook reads.
  return { mutate: calls as unknown as StructuredAgentSessionMutate, calls }
}

type RenderProps = {
  transportEnabled: boolean
  fence: number | null
  turnId?: string | null
  launchSeedOptions?: Record<string, string>
}

// A new chat: create has not published, so there is no fence and no live read.
const PROVISIONAL: RenderProps = { transportEnabled: false, fence: null }
// The receipt lands first; attach delivers the fence on a later render.
const PUBLISHED_UNATTACHED: RenderProps = { transportEnabled: true, fence: null }
const ATTACHED: RenderProps = { transportEnabled: true, fence: 1 }

function renderOptions(initial: RenderProps, mutate: StructuredAgentSessionMutate) {
  return renderHook(
    (props: RenderProps) =>
      useStructuredAgentSessionOptions({
        agent: 'codex',
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        transportEnabled: props.transportEnabled,
        providerVisible: props.transportEnabled,
        fence: props.fence,
        turnId: props.turnId ?? null,
        unloadedTurnRevisions: undefined,
        mutate,
        ...(props.launchSeedOptions ? { launchSeedOptions: props.launchSeedOptions } : {})
      }),
    { initialProps: initial }
  )
}

function descriptor(snapshot: readonly SessionOptionDescriptor[], id: string) {
  return snapshot.find((entry) => entry.id === id)
}

function currentValue(snapshot: readonly SessionOptionDescriptor[], id: string) {
  const entry = descriptor(snapshot, id)
  return entry?.kind.type === 'select' ? (entry.kind.currentValue ?? null) : null
}

function modelChoiceCount(snapshot: readonly SessionOptionDescriptor[]): number {
  const model = descriptor(snapshot, 'model')
  return model?.kind.type === 'select' ? model.kind.choices.length : 0
}

function setOptionCalls(calls: ReturnType<typeof vi.fn<MutateCall>>): unknown[] {
  return calls.mock.calls
    .filter(([method]) => method === 'agentSession.setOption')
    .map(([, , fields]) => fields)
}

const HOST_CATALOG = {
  origin: 'live-session',
  models: [
    {
      id: 'gpt-hosted',
      label: 'GPT Hosted',
      isDefault: true,
      efforts: [{ value: 'high', label: 'High' }]
    }
  ],
  fetchedAt: 1_000
}

const LIVE_OPTIONS = {
  models: [
    { id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true, efforts: [] },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: [] }
  ],
  current: { model: 'gpt-5.5', confirmed: ['model'] }
}

const SEED = { model: 'gpt-5.5' }
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('useStructuredAgentSessionOptions', () => {
  beforeEach(() => {
    mocks.call.mockReset()
    mocks.enqueue.mockReset()
  })

  it('upgrades the seed with the host catalog while the live read is still pending', async () => {
    answer({ modelCatalog: () => Promise.resolve(HOST_CATALOG) })
    const { result, unmount } = renderOptions(ATTACHED, mutateWith(async () => null).mutate)
    await waitFor(() => {
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-hosted')
      expect(descriptor(result.current.optionSnapshot, 'model')?.valueSource).toBe('default')
    })
    unmount()
  })

  it('treats method_not_found and forbidden as an absent surface and keeps the seed', async () => {
    for (const code of ['method_not_found', 'forbidden']) {
      answer({ modelCatalog: () => Promise.reject(new FakeRpcCallError(code)) })
      const { result, unmount } = renderOptions(
        { ...PROVISIONAL, launchSeedOptions: SEED },
        mutateWith(async () => null).mutate
      )
      await tick()
      expect(modelChoiceCount(result.current.optionSnapshot)).toBeGreaterThan(0)
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.5')
      unmount()
    }
  })

  it('lets the live options result win over a later host catalog answer', async () => {
    let settleCatalog!: (value: unknown) => void
    answer({
      options: () => Promise.resolve(LIVE_OPTIONS),
      modelCatalog: () => new Promise((resolve) => (settleCatalog = resolve))
    })
    const { result, unmount } = renderOptions(ATTACHED, mutateWith(async () => null).mutate)
    await waitFor(() =>
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.5')
    )
    settleCatalog(HOST_CATALOG)
    await tick()
    const model = descriptor(result.current.optionSnapshot, 'model')
    expect(model?.kind.type === 'select' ? model.kind.currentValue : null).toBe('gpt-5.5')
    expect(
      model?.kind.type === 'select' &&
        model.kind.choices.some((choice) => choice.value === 'gpt-hosted')
    ).toBe(false)
    unmount()
  })

  describe('while the launch is provisional', () => {
    it('renders the launch default and holds a pick without any RPC', async () => {
      answer({})
      const { mutate, calls } = mutateWith(async () => null)
      const { result, unmount } = renderOptions({ ...PROVISIONAL, launchSeedOptions: SEED }, mutate)
      expect(modelChoiceCount(result.current.optionSnapshot)).toBeGreaterThan(0)
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.5')

      let accepted = false
      await act(async () => {
        accepted = await result.current.setStructuredOption('model', 'gpt-5.6-luna')
      })
      expect(accepted).toBe(true)
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-luna')
      expect(descriptor(result.current.optionSnapshot, 'model')?.valueSource).toBe('dispatched')
      // A held pick is not in flight (no pendingId): a re-pick is accepted and replaces it.
      await act(async () => {
        accepted = await result.current.setStructuredOption('model', 'gpt-5.6-terra')
      })
      expect(accepted).toBe(true)
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-terra')
      expect(calls).not.toHaveBeenCalled()
      expect(mocks.call.mock.calls.map(([, method]) => method)).toEqual([
        'agentSession.modelCatalog'
      ])
      expect(mocks.enqueue).not.toHaveBeenCalled()
      unmount()
    })

    it('names the host catalog default when no selection is stored', async () => {
      answer({ modelCatalog: () => Promise.resolve(HOST_CATALOG) })
      const { result, unmount } = renderOptions(PROVISIONAL, mutateWith(async () => null).mutate)
      await waitFor(() =>
        expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-hosted')
      )
      unmount()
    })

    it('keeps the host catalog default through attach instead of blanking it', async () => {
      // Only the first catalog read answers; the re-read at the new fence never does.
      let catalogReads = 0
      answer({
        modelCatalog: () =>
          ++catalogReads === 1 ? Promise.resolve(HOST_CATALOG) : new Promise(() => {})
      })
      const { result, rerender, unmount } = renderOptions(
        PROVISIONAL,
        mutateWith(async () => null).mutate
      )
      await waitFor(() =>
        expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-hosted')
      )
      rerender(ATTACHED)
      expect(catalogReads).toBe(2)
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-hosted')
      unmount()
    })

    it('re-derives the shown default when the stored selection changes', () => {
      answer({})
      const { result, rerender, unmount } = renderOptions(
        { ...PROVISIONAL, launchSeedOptions: SEED },
        mutateWith(async () => null).mutate
      )
      rerender({ ...PROVISIONAL, launchSeedOptions: { model: 'gpt-5.6-terra' } })
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-terra')
      unmount()
    })

    it('flushes one setOption with the held value once the session attaches', async () => {
      answer({})
      const { mutate, calls } = mutateWith(async () => ({
        key: 'model',
        value: 'gpt-5.6-luna',
        options: { model: 'gpt-5.6-luna' }
      }))
      const { result, rerender, unmount } = renderOptions(
        { ...PROVISIONAL, launchSeedOptions: SEED },
        mutate
      )
      await act(async () => {
        await result.current.setStructuredOption('model', 'gpt-5.6-luna')
      })
      // Published but not yet attached: still nowhere to deliver it.
      rerender({ ...PUBLISHED_UNATTACHED, launchSeedOptions: SEED })
      await tick()
      expect(calls).not.toHaveBeenCalled()
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-luna')

      rerender({ ...ATTACHED, launchSeedOptions: SEED })
      await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1))
      expect(setOptionCalls(calls)).toEqual([{ key: 'model', value: 'gpt-5.6-luna' }])
      expect(mocks.enqueue).toHaveBeenCalledWith(LOCAL_TARGET, {
        type: 'apply-picks',
        agent: 'codex',
        picks: [{ modelId: 'gpt-5.6-luna', optionId: 'model', value: 'gpt-5.6-luna' }]
      })
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-luna')
      unmount()
    })

    it('sends no setOption at attach when nothing was picked', async () => {
      answer({})
      const { mutate, calls } = mutateWith(async () => null)
      const { rerender, unmount } = renderOptions(
        { ...PROVISIONAL, launchSeedOptions: SEED },
        mutate
      )
      rerender({ ...ATTACHED, launchSeedOptions: SEED })
      await tick()
      expect(setOptionCalls(calls)).toEqual([])
      unmount()
    })

    it('flushes only the last of two picks', async () => {
      answer({})
      const { mutate, calls } = mutateWith(async () => ({
        key: 'model',
        value: 'gpt-5.6-terra',
        options: { model: 'gpt-5.6-terra' }
      }))
      const { result, rerender, unmount } = renderOptions(
        { ...PROVISIONAL, launchSeedOptions: SEED },
        mutate
      )
      await act(async () => {
        await result.current.setStructuredOption('model', 'gpt-5.6-luna')
      })
      await act(async () => {
        await result.current.setStructuredOption('model', 'gpt-5.6-terra')
      })
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-terra')

      rerender({ ...ATTACHED, launchSeedOptions: SEED })
      await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1))
      expect(setOptionCalls(calls)).toEqual([{ key: 'model', value: 'gpt-5.6-terra' }])
      unmount()
    })

    it('reverts a refused flush to the value the session runs and persists nothing', async () => {
      answer({ options: () => Promise.resolve(LIVE_OPTIONS) })
      let refuse!: (value: null) => void
      const { mutate, calls } = mutateWith(() => new Promise((resolve) => (refuse = resolve)))
      const { result, rerender, unmount } = renderOptions(
        { ...PROVISIONAL, launchSeedOptions: SEED },
        mutate
      )
      await act(async () => {
        await result.current.setStructuredOption('model', 'gpt-5.6-luna')
      })
      rerender({ ...ATTACHED, launchSeedOptions: SEED })
      await waitFor(() => expect(setOptionCalls(calls)).toHaveLength(1))
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.6-luna')

      // No fresh read after the refusal: the revert must not wait on one.
      const readsBeforeRefusal = mocks.call.mock.calls.length
      await act(async () => {
        refuse(null)
        await tick()
      })
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe('gpt-5.5')
      expect(mocks.call.mock.calls.length).toBe(readsBeforeRefusal)
      expect(mocks.enqueue).not.toHaveBeenCalled()
      expect(setOptionCalls(calls)).toHaveLength(1)
      unmount()
    })

    it('drops a held pick on unmount: no setOption, no durable write', async () => {
      answer({})
      const { mutate, calls } = mutateWith(async () => null)
      const { result, unmount } = renderOptions({ ...PROVISIONAL, launchSeedOptions: SEED }, mutate)
      await act(async () => {
        await result.current.setStructuredOption('model', 'gpt-5.6-luna')
      })
      unmount()
      await tick()
      expect(calls).not.toHaveBeenCalled()
      expect(mocks.enqueue).not.toHaveBeenCalled()
    })
  })
})
