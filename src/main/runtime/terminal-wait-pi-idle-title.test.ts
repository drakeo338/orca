import { describe, expect, it } from 'vitest'
import { detectExplicitIdleStatusFromTitle } from './terminal-wait-detection'

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
