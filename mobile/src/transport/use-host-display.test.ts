import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostDisplayResolution } from '../../../src/shared/host-display-resolution'
import { recordHostDescriptor, resetHostDescriptorStoreForTests } from './host-descriptor-store'
import { useHostDisplay, type HostDisplaySource } from './use-host-display'

function renderDisplay(host: HostDisplaySource): HostDisplayResolution | null {
  let display: HostDisplayResolution | null = null
  function Probe(): null {
    display = useHostDisplay(host, true)
    return null
  }
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  act(() => {
    renderer = create(createElement(Probe))
  })
  consoleError.mockRestore()
  return display
}

let renderer: ReactTestRenderer | null = null

describe('useHostDisplay', () => {
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetHostDescriptorStoreForTests()
  })

  it('keeps a label that arrives without identity fields above the live machine name', () => {
    // The web page receives only the app's resolved `name`, which may be the user's rename.
    recordHostDescriptor('desk', { machineName: 'm4airs-Air', platform: 'darwin' })
    expect(renderDisplay({ id: 'desk', name: 'Windows-Low Spec' })).toEqual({
      title: 'Windows-Low Spec',
      descriptorLine: 'macOS · m4airs-Air',
      lastKnown: false
    })
  })

  it('lets the live machine name replace a generated name that arrives without identity fields', () => {
    recordHostDescriptor('desk', { machineName: 'm4airs-Air', platform: 'darwin' })
    expect(renderDisplay({ id: 'desk', name: 'Host 2' })?.title).toBe('m4airs-Air')
  })
})
