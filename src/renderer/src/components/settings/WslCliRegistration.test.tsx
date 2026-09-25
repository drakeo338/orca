// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import { notifyOrcaCliInstallStateChanged } from '@/lib/orca-cli-install-state-event'
import { WslCliRegistration } from './WslCliRegistration'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/lib/windows-terminal-capabilities', () => ({
  useWindowsTerminalCapabilities: () => ({ wslAvailable: true })
}))

afterEach(() => {
  cleanup()
})

function wslStatus(overrides: Partial<CliInstallStatus>): CliInstallStatus {
  return {
    platform: 'linux',
    commandName: 'orca-ide',
    commandPath: '/home/user/.local/bin/orca-ide',
    pathDirectory: '/home/user/.local/bin',
    pathConfigured: true,
    launcherPath: null,
    installMethod: 'symlink',
    supported: true,
    state: 'not_installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: null,
    ...overrides
  }
}

describe('WslCliRegistration', () => {
  it('re-reads on a CLI broadcast without flashing the checking state or disabling the toggle', async () => {
    let resolveBroadcastRead: (status: CliInstallStatus) => void = () => {}
    const getWslInstallStatus = vi
      .fn()
      .mockResolvedValueOnce(wslStatus({ state: 'not_installed' }))
      .mockReturnValueOnce(
        new Promise<CliInstallStatus>((resolve) => {
          resolveBroadcastRead = resolve
        })
      )
    Object.assign(window, {
      api: { cli: { getWslInstallStatus, installWsl: vi.fn(), removeWsl: vi.fn() } }
    })

    render(<WslCliRegistration currentPlatform="win32" />)
    const registrationSwitch = screen.getByRole('switch')
    await waitFor(() => expect(registrationSwitch.hasAttribute('disabled')).toBe(false))
    expect(registrationSwitch.getAttribute('aria-checked')).toBe('false')

    act(() => notifyOrcaCliInstallStateChanged())

    expect(getWslInstallStatus).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Checking WSL CLI registration...')).toBeNull()
    expect(registrationSwitch.hasAttribute('disabled')).toBe(false)
    expect(registrationSwitch.getAttribute('aria-checked')).toBe('false')

    await act(async () => resolveBroadcastRead(wslStatus({ state: 'installed' })))

    expect(registrationSwitch.getAttribute('aria-checked')).toBe('true')
    expect(registrationSwitch.hasAttribute('disabled')).toBe(false)
  })
})
