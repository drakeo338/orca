import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runKeyedSerializedOperation } from '../../cli/keyed-promise-queue'
import type { StructuredAgentSessionResumeOutcome } from './structured-agent-session-hold-resume'
import { StructuredAgentSessionHolds } from './structured-agent-session-holds'

const GRACE_MS = 15_000
const pendingHolds: StructuredAgentSessionHolds[] = []

/** The host's per-session queue: a second hold waits for the attach the first one is running. */
function keyedSerialize() {
  const chains = new Map<string, Promise<void>>()
  return <T>(sessionId: string, task: () => Promise<T>) =>
    runKeyedSerializedOperation(chains, sessionId, task)
}

function resumeHarness() {
  const resumeGate = Promise.withResolvers<void>()
  let child = false
  let turnActive = false
  const evict = vi.fn(async () => {
    child = false
  })
  const resume = vi.fn(async () => {
    await resumeGate.promise
    child = true
    return { ok: true as const }
  })
  const holds = new StructuredAgentSessionHolds({
    resume,
    serialize: keyedSerialize(),
    hasProviderChild: () => child,
    isWorking: () => turnActive,
    evict,
    graceMs: GRACE_MS
  })
  pendingHolds.push(holds)
  return {
    holds,
    resume,
    resumeGate,
    evict,
    hasChild: () => child,
    setTurnActive: (value: boolean) => {
      turnActive = value
    }
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const holds of pendingHolds.splice(0)) {
    holds.dispose()
  }
  vi.useRealTimers()
})

describe('a surface leaving while its structured session resumes', () => {
  it('releases the acquired child after the last surface disconnects during resume', async () => {
    const { holds, resumeGate, evict, hasChild } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')

    holds.release('session-1', 'connection-1:chat')
    expect(holds.isReleasePending('session-1')).toBe(false)
    resumeGate.resolve()
    await hold

    expect(hasChild()).toBe(true)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(true)
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1)
    expect(evict).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
    expect(hasChild()).toBe(false)
  })

  it('waits for an active turn before releasing the late child', async () => {
    const { holds, resumeGate, evict, setTurnActive } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    setTurnActive(true)
    resumeGate.resolve()
    await hold

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(evict).not.toHaveBeenCalled()
    expect(holds.isReleasePending('session-1')).toBe(true)

    setTurnActive(false)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it.each([false, true])('preserves an arriving holder with resume=%s', async (resume) => {
    const { holds, resumeGate, evict } = resumeHarness()
    const first = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    const replacement = holds.hold('session-1', 'connection-2:chat', { resume })
    resumeGate.resolve()
    await Promise.all([first, replacement])

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isHeld('session-1')).toBe(true)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()

    holds.release('session-1', 'connection-2:chat')
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it('cancels the late-child release when a surface reconnects during grace', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    resumeGate.resolve()
    await hold
    expect(holds.isReleasePending('session-1')).toBe(true)

    await holds.hold('session-1', 'connection-2:chat')
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('preserves a failed resume without scheduling eviction', async () => {
    const { holds, resumeGate, evict, hasChild } = resumeHarness()
    const failure = new Error('provider acquisition failed')
    const hold = holds.hold('session-1', 'connection-1:chat')
    const rejected = expect(hold).rejects.toBe(failure)
    holds.release('session-1', 'connection-1:chat')
    resumeGate.reject(failure)
    await rejected

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(hasChild()).toBe(false)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('leaves late acquisition cleanup to host teardown after disposal', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.release('session-1', 'connection-1:chat')
    holds.dispose()
    resumeGate.resolve()
    await hold

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('does not restart release timers when a surface leaves after disposal', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    resumeGate.resolve()
    await hold
    holds.dispose()
    holds.release('session-1', 'connection-1:chat')

    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(false)
    expect(evict).not.toHaveBeenCalled()
  })

  it('releases a late child acquired after explicit close forgot its holders', async () => {
    const { holds, resumeGate, evict } = resumeHarness()
    const hold = holds.hold('session-1', 'connection-1:chat')
    holds.forget('session-1')
    resumeGate.resolve()
    await hold

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(evict).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it.each([false, true])(
    'keeps a reused holder when old resume fails (replacement finished=%s)',
    async (replacementFinished) => {
      const firstGate = Promise.withResolvers<void>()
      const replacementGate = Promise.withResolvers<void>()
      let child = false
      const resume = vi
        .fn()
        .mockImplementationOnce(() => firstGate.promise)
        .mockImplementationOnce(async () => {
          await replacementGate.promise
          child = true
        })
      const evict = vi.fn(async () => {})
      const holds = new StructuredAgentSessionHolds({
        resume,
        hasProviderChild: () => child,
        isWorking: () => false,
        evict,
        graceMs: GRACE_MS
      })
      pendingHolds.push(holds)
      const first = holds.hold('session-1', 'same-holder')
      const rejected = expect(first).rejects.toThrow('old acquisition failed')
      holds.release('session-1', 'same-holder')
      const replacement = holds.hold('session-1', 'same-holder')
      if (replacementFinished) {
        replacementGate.resolve()
        await replacement
      }

    // The gate stays rejected, so the replacement's own attempt fails the same way.
    resumeGate.reject(new Error('acquisition failed'))
    await Promise.all([firstRejected, replacementRejected])

    expect(resume).toHaveBeenCalledTimes(2)
    expect(holds.isHeld('session-1')).toBe(false)
    expect(holds.isReleasePending('session-1')).toBe(false)
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
    expect(evict).not.toHaveBeenCalled()
  })

  it('keeps a re-hold that finds the child the failing attempt ahead of it left behind', async () => {
    const gate = Promise.withResolvers<void>()
    let child = false
    const holds = new StructuredAgentSessionHolds({
      resume,
      hasProviderChild: () => false,
      isWorking: () => false,
      evict: async () => {},
      graceMs: GRACE_MS
    })
    pendingHolds.push(holds)
    const first = holds.hold('session-1', 'same-holder')
    const rejected = expect(first).rejects.toThrow('acquisition failed')
    holds.release('session-1', 'same-holder')
    const replacement = holds.hold('session-1', 'same-holder')

    gate.reject(new Error('acquisition failed'))
    await rejected
    // The first hold's failure released only the holder it added, at the incarnation it added;
    // the replacement then ran, found the child, and kept the holder it re-took.
    await replacement

    expect(holds.isHeld('session-1')).toBe(true)
    expect(holds.isReleasePending('session-1')).toBe(false)
  })

  it('starts a fresh resume once the failed one has settled', async () => {
    let child = false
    const resume = vi
      .fn<() => Promise<StructuredAgentSessionResumeOutcome>>()
      .mockRejectedValueOnce(new Error('first acquisition failed'))
      .mockImplementationOnce(async () => {
        child = true
        return { ok: true }
      })
      const holds = new StructuredAgentSessionHolds({
        resume,
        hasProviderChild: () => child,
        isWorking: () => turnActive,
        evict,
        graceMs: GRACE_MS
      })
      pendingHolds.push(holds)
      const first = holds.hold('session-1', 'old-holder')
      holds.release('session-1', 'old-holder')
      const replacement = holds.hold('session-1', replacementHolder)
      const rejected = expect(replacement).rejects.toThrow('replacement acquisition failed')
      firstGate.resolve()
      await first
      expect(holds.isReleasePending('session-1')).toBe(false)

    await expect(holds.hold('session-1', 'chat-1')).rejects.toThrow('first acquisition failed')
    await holds.hold('session-1', 'chat-1')

    expect(resume).toHaveBeenCalledTimes(2)
    expect(holds.isHeld('session-1')).toBe(true)
  })
})
