import { describe, expect, it } from 'vitest'
import { resolveHostDisplay } from './host-display-resolution'

describe('resolveHostDisplay', () => {
  it('titles with the caller label and shows a disagreeing machine name beneath it', () => {
    expect(
      resolveHostDisplay({
        name: 'Windows-Low Spec',
        machineName: 'm4airs-Air',
        platform: 'darwin',
        live: true
      })
    ).toEqual({
      title: 'Windows-Low Spec',
      descriptorLine: 'macOS · m4airs-Air',
      lastKnown: false
    })
  })

  it('never titles with the machine name, whatever the label state', () => {
    // The title-fallback bug class: a late descriptor must not be able to retitle a row.
    for (const name of ['Host 2', 'Desk']) {
      expect(
        resolveHostDisplay({ name, machineName: 'm4airs-Air', platform: 'darwin', live: true })
          .title
      ).toBe(name)
    }
  })

  it('keeps the OS visible when the shown name is the machine name', () => {
    expect(
      resolveHostDisplay({
        name: 'm4airs-Air',
        machineName: 'm4airs-Air',
        platform: 'darwin',
        live: true
      })
    ).toEqual({ title: 'm4airs-Air', descriptorLine: 'macOS', lastKnown: false })
  })

  it('labels whichever descriptor half an older host reported', () => {
    expect(resolveHostDisplay({ name: 'Desk', platform: 'linux', live: true })).toEqual({
      title: 'Desk',
      descriptorLine: 'Linux',
      lastKnown: false
    })
    expect(resolveHostDisplay({ name: 'Desk', machineName: 'build-box', live: true })).toEqual({
      title: 'Desk',
      descriptorLine: 'build-box',
      lastKnown: false
    })
    expect(resolveHostDisplay({ name: 'Desk', live: true })).toEqual({
      title: 'Desk',
      descriptorLine: null,
      lastKnown: false
    })
  })

  it('marks a stored descriptor as last known exactly when the host is not live', () => {
    const stored = { name: 'Desk', machineName: 'm4airs-Air', platform: 'darwin' as const }
    expect(resolveHostDisplay({ ...stored, live: false }).lastKnown).toBe(true)
    expect(resolveHostDisplay({ ...stored, live: true }).lastKnown).toBe(false)
    // No descriptor line means nothing to call last known.
    expect(resolveHostDisplay({ name: 'Desk', live: false }).lastKnown).toBe(false)
  })

  it('normalizes blank inputs', () => {
    expect(resolveHostDisplay({ name: '  ', machineName: '  ', live: false })).toEqual({
      title: 'Host',
      descriptorLine: null,
      lastKnown: false
    })
  })
})
