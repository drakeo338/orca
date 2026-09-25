// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import { ORCA_CLI_INSTALL_STATE_EVENT } from '@/lib/orca-cli-install-state-event'
import { ORCHESTRATION_ENABLED_STORAGE_KEY } from '@/lib/orchestration-setup-state'
import { useFloatingTerminalOrchestrationVisibility } from './use-floating-terminal-orchestration-visibility'

function cliStatus(overrides: Partial<CliInstallStatus>): CliInstallStatus {
  return {
    platform: 'darwin',
    commandName: 'orca',
    commandPath: '/usr/local/bin/orca',
    pathDirectory: '/usr/local/bin',
    pathConfigured: true,
    launcherPath: '/Applications/Orca.app/Contents/MacOS/Orca',
    installMethod: 'symlink',
    supported: true,
    state: 'installed',
    currentTarget: '/Applications/Orca.app/Contents/MacOS/Orca',
    unsupportedReason: null,
    detail: null,
    ...overrides
  }
}

const getInstallStatus = vi.fn<() => Promise<CliInstallStatus>>()

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(ORCHESTRATION_ENABLED_STORAGE_KEY, '1')
  getInstallStatus.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { cli: { getInstallStatus } }
  })
})

afterEach(() => {
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'api')
})

describe('useFloatingTerminalOrchestrationVisibility', () => {
  it('drops the setup banner when the CLI is registered from another surface', async () => {
    getInstallStatus.mockResolvedValueOnce(cliStatus({ state: 'not_installed' }))
    const setShowOrchestrationSetup = vi.fn()
    renderHook(() =>
      useFloatingTerminalOrchestrationVisibility({
        mountedRef: { current: true },
        setShowOrchestrationSetup,
        open: true
      })
    )
    await act(async () => {})
    expect(setShowOrchestrationSetup).toHaveBeenLastCalledWith(true)

    getInstallStatus.mockResolvedValueOnce(cliStatus({}))
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ORCA_CLI_INSTALL_STATE_EVENT))
    })

    expect(getInstallStatus).toHaveBeenCalledTimes(2)
    expect(setShowOrchestrationSetup).toHaveBeenLastCalledWith(false)
  })
})
