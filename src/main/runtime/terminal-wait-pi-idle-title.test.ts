import { describe, expect, it } from 'vitest'
import { detectExplicitIdleStatusFromTitle } from './terminal-wait-detection'
import { hasExplicitIdleTitle } from './tui-idle-evidence'

// Why: Pi/OMP encodes turn state as `π <marker> <label>`; a fresh pane shows `π > dir`
// until its first turn, so tui-idle readiness must accept the state-marker idle title.
describe('detectExplicitIdleStatusFromTitle for Pi/OMP titles', () => {
  it('treats the legacy idle title as idle', () => {
    expect(detectExplicitIdleStatusFromTitle('π - dir')).toBe('idle')
  })

  it('treats the OMP state-marker idle title as idle', () => {
    expect(detectExplicitIdleStatusFromTitle('π > dir')).toBe('idle')
  })

  it('does not treat the permission marker as idle', () => {
    expect(detectExplicitIdleStatusFromTitle('π ! dir')).toBeNull()
  })

  it('does not treat the working marker as idle', () => {
    expect(detectExplicitIdleStatusFromTitle('π : dir')).toBeNull()
  })
})

// Why: main's 3s stale timer rewrites OMP's static `π : dir` to `π > dir` mid-turn on WSL/ConPTY.
describe('hasExplicitIdleTitle for stale-cleared Pi/OMP titles', () => {
  const base = { lastAgentStatus: 'idle' as const, lastOutputAt: null }

  it('accepts a `π > dir` the agent emitted', () => {
    expect(hasExplicitIdleTitle({ ...base, lastOscTitle: 'π > dir' })).toBe(true)
  })

  it('ignores a `π > dir` the stale timer synthesized', () => {
    expect(
      hasExplicitIdleTitle({ ...base, lastOscTitle: 'π > dir', lastOscTitleStaleCleared: true })
    ).toBe(false)
  })

  it('keeps the legacy `π - dir` idle even when stale-cleared', () => {
    expect(
      hasExplicitIdleTitle({ ...base, lastOscTitle: 'π - dir', lastOscTitleStaleCleared: true })
    ).toBe(true)
  })
})
