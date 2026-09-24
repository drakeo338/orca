import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { CliInstallStatus } from '../../../shared/cli-install-types'
import {
  CLI_PREREQUISITE_REGISTRATION_TOAST,
  CLI_PREREQUISITE_REGISTRATION_TOAST_DESCRIPTION,
  ensureOrcaCliAvailableForAgentSkillTerminal,
  isOrcaCliAvailableOnPath
} from './agent-skill-cli-prerequisite'
import { ORCA_CLI_INSTALL_STATE_EVENT } from './orca-cli-install-state-event'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    warning: vi.fn()
  }
}))

function cliStatus(overrides: Partial<CliInstallStatus> = {}): CliInstallStatus {
  return {
    platform: 'darwin',
    commandName: 'orca',
    commandPath: '/usr/local/bin/orca',
    pathDirectory: '/usr/local/bin',
    pathConfigured: true,
    launcherPath: '/Applications/Orca.app/Contents/MacOS/orca',
    installMethod: 'symlink',
    supported: true,
    state: 'installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: null,
    ...overrides
  }
}

describe('isOrcaCliAvailableOnPath', () => {
  it('requires the installed CLI command to be visible on PATH', () => {
    expect(isOrcaCliAvailableOnPath(cliStatus())).toBe(true)
    expect(isOrcaCliAvailableOnPath(cliStatus({ pathConfigured: false }))).toBe(false)
    expect(isOrcaCliAvailableOnPath(cliStatus({ state: 'not_installed' }))).toBe(false)
  })
})

describe('ensureOrcaCliAvailableForAgentSkillTerminal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('runs the CLI installer when the command exists but is not visible on PATH', async () => {
    const initial = cliStatus({
      pathConfigured: false,
      detail: '/usr/local/bin is not currently visible on PATH.'
    })
    const installed = cliStatus()
    const getInstallStatus = vi.fn().mockResolvedValue(initial)
    const install = vi.fn().mockResolvedValue(installed)
    const onStatusChange = vi.fn()
    const dispatchEvent = vi.fn()

    vi.stubGlobal('window', {
      api: {
        cli: {
          getInstallStatus,
          install
        }
      },
      dispatchEvent
    })

    await expect(
      ensureOrcaCliAvailableForAgentSkillTerminal({
        onStatusChange,
        registrationPromptDelayMs: 0
      })
    ).resolves.toBe(installed)

    expect(install).toHaveBeenCalledTimes(1)
    // Why: every other CLI status reader (checklist, sidebar, panes) re-reads on this event.
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: ORCA_CLI_INSTALL_STATE_EVENT })
    expect(toast.message).toHaveBeenCalledWith(CLI_PREREQUISITE_REGISTRATION_TOAST, {
      description: CLI_PREREQUISITE_REGISTRATION_TOAST_DESCRIPTION
    })
    expect(onStatusChange).toHaveBeenNthCalledWith(1, initial)
    expect(onStatusChange).toHaveBeenNthCalledWith(2, installed)
  })

  it('does not run the CLI installer when the Windows PATH read is unknown', async () => {
    const initial = cliStatus({
      platform: 'win32',
      pathConfigured: null,
      detail: 'Orca could not read the Windows user PATH registry value.'
    })
    const install = vi.fn()
    vi.stubGlobal('window', {
      api: { cli: { getInstallStatus: vi.fn().mockResolvedValue(initial), install } },
      dispatchEvent: vi.fn()
    })

    await expect(
      ensureOrcaCliAvailableForAgentSkillTerminal({ registrationPromptDelayMs: 0 })
    ).resolves.toBe(initial)

    expect(install).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/could not check/i),
      expect.objectContaining({ description: initial.detail })
    )
  })

  it('has readers re-read when the CLI is already registered and nothing is installed', async () => {
    const install = vi.fn()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', {
      api: { cli: { getInstallStatus: vi.fn().mockResolvedValue(cliStatus()), install } },
      dispatchEvent
    })

    await ensureOrcaCliAvailableForAgentSkillTerminal({ registrationPromptDelayMs: 0 })

    expect(install).not.toHaveBeenCalled()
    // Why: readers may still hold an older answer that this fresh read contradicts.
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: ORCA_CLI_INSTALL_STATE_EVENT })
  })

  it('lets the registration toast paint before opening the native installer', async () => {
    vi.useFakeTimers()
    const initial = cliStatus({ state: 'stale' })
    const installed = cliStatus()
    const getInstallStatus = vi.fn().mockResolvedValue(initial)
    const install = vi.fn().mockResolvedValue(installed)

    vi.stubGlobal('window', {
      setTimeout,
      dispatchEvent: vi.fn(),
      api: {
        cli: {
          getInstallStatus,
          install
        }
      }
    })

    const pending = ensureOrcaCliAvailableForAgentSkillTerminal({ registrationPromptDelayMs: 700 })
    await vi.waitFor(() => {
      expect(toast.message).toHaveBeenCalledWith(CLI_PREREQUISITE_REGISTRATION_TOAST, {
        description: CLI_PREREQUISITE_REGISTRATION_TOAST_DESCRIPTION
      })
    })
    expect(install).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(700)
    await expect(pending).resolves.toBe(installed)
    expect(install).toHaveBeenCalledTimes(1)
  })
})
