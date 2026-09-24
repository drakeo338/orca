// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallStatus } from '../../../shared/cli-install-types'
import { ORCA_CLI_INSTALL_STATE_EVENT } from './orca-cli-install-state-event'
import { ensureAgentRuntimeCliRegistered } from './orca-cli-install-status'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

function cliStatus(overrides: Partial<CliInstallStatus> = {}): CliInstallStatus {
  return {
    platform: 'darwin',
    commandName: 'orca',
    commandPath: '/usr/local/bin/orca',
    pathDirectory: '/usr/local/bin',
    pathConfigured: true,
    launcherPath: null,
    installMethod: 'symlink',
    supported: true,
    state: 'installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: null,
    ...overrides
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'api')
})

describe('ensureAgentRuntimeCliRegistered', () => {
  it('has readers re-read once even when the CLI was already registered and nothing was installed', async () => {
    const cli = {
      getInstallStatus: vi.fn(async () => cliStatus()),
      getWslInstallStatus: vi.fn(async () => cliStatus({ platform: 'linux' })),
      install: vi.fn(),
      installWsl: vi.fn()
    }
    Reflect.set(window, 'api', { cli })
    const listener = vi.fn()
    window.addEventListener(ORCA_CLI_INSTALL_STATE_EVENT, listener)
    try {
      await ensureAgentRuntimeCliRegistered()
      expect(listener).toHaveBeenCalledTimes(1)
      await ensureAgentRuntimeCliRegistered({ runtime: 'wsl', wslDistro: 'Ubuntu', label: 'WSL' })
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener(ORCA_CLI_INSTALL_STATE_EVENT, listener)
    }

    expect(cli.getInstallStatus).toHaveBeenCalledTimes(1)
    expect(cli.getWslInstallStatus).toHaveBeenCalledWith({ distro: 'Ubuntu' })
    expect(cli.install).not.toHaveBeenCalled()
    expect(cli.installWsl).not.toHaveBeenCalled()
  })

  it('has readers re-read once when registration runs, not once per step', async () => {
    const cli = {
      getInstallStatus: vi.fn(async () => cliStatus({ state: 'not_installed' })),
      install: vi.fn(async () => cliStatus())
    }
    Reflect.set(window, 'api', { cli })
    vi.useFakeTimers()
    const listener = vi.fn()
    window.addEventListener(ORCA_CLI_INSTALL_STATE_EVENT, listener)
    try {
      const pending = ensureAgentRuntimeCliRegistered()
      await vi.runAllTimersAsync()
      await pending
    } finally {
      window.removeEventListener(ORCA_CLI_INSTALL_STATE_EVENT, listener)
      vi.useRealTimers()
    }

    expect(cli.install).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
