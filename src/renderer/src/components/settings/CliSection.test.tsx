// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  ORCA_CLI_SKILL_INSTALL_COMMAND,
  ORCA_CLI_SKILL_UPDATE_COMMAND
} from '@/lib/agent-feature-install-commands'
import { getOrcaCliInstallTargetKey, type OrcaCliSkillRuntime } from '@/lib/orca-cli-install-status'
import { notifyOrcaCliInstallStateChanged } from '@/lib/orca-cli-install-state-event'
import { CliSection } from './CliSection'

type CapturedPanelProps = {
  command: string
  installedCommand: string
  terminalRuntime?: { runtime: 'host' | 'wsl'; wslDistro?: string | null; label: string }
  freshnessSkillName?: string
  prerequisiteRuntime?: OrcaCliSkillRuntime
  onBeforeOpenTerminal: () => Promise<void>
}

const capturedPanel = vi.hoisted(() => {
  const captured: {
    canUseLocalSkillFreshness: boolean
    props: CapturedPanelProps | null
    useInstalledAgentSkill: ReturnType<typeof vi.fn>
  } = { canUseLocalSkillFreshness: true, props: null, useInstalledAgentSkill: vi.fn() }
  return captured
})
const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: ['global'],
  useInstalledAgentSkill: capturedPanel.useInstalledAgentSkill
}))

vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({
    canUseLocalSkillFreshness: capturedPanel.canUseLocalSkillFreshness
  })
}))

capturedPanel.useInstalledAgentSkill.mockReturnValue({
  installed: false,
  loading: false,
  error: null,
  refresh: vi.fn()
})

afterEach(() => {
  cleanup()
  capturedPanel.canUseLocalSkillFreshness = true
  toastError.mockReset()
  vi.unstubAllGlobals()
})

vi.mock('./AgentSkillSetupPanel', () => ({
  AgentSkillSetupPanel: function AgentSkillSetupPanel(props: CapturedPanelProps) {
    capturedPanel.props = props
    return <div data-testid="agent-skill-setup-panel" />
  }
}))

vi.mock('./CliRegistrationDialog', () => ({
  CliRegistrationDialog: function CliRegistrationDialog() {
    return null
  }
}))

vi.mock('./WslCliRegistration', () => ({
  WslCliRegistration: function WslCliRegistration() {
    return null
  }
}))

describe('CliSection project runtime defaults', () => {
  it('exposes freshness only for a resolved local host runtime', () => {
    const settings = getDefaultSettings('/tmp')
    renderToStaticMarkup(<CliSection currentPlatform="darwin" settings={settings} />)
    expect(capturedPanel.props?.freshnessSkillName).toBe('orca-cli')

    capturedPanel.canUseLocalSkillFreshness = false
    renderToStaticMarkup(<CliSection currentPlatform="darwin" settings={settings} />)
    expect(capturedPanel.props?.freshnessSkillName).toBeUndefined()

    capturedPanel.canUseLocalSkillFreshness = true
    renderToStaticMarkup(
      <CliSection
        currentPlatform="win32"
        settings={{
          ...settings,
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' }
        }}
        wslSupportedPlatform
        wslAvailable
      />
    )
    expect(capturedPanel.props?.freshnessSkillName).toBeUndefined()
  })

  it('passes the default project WSL distro to CLI skill prerequisite checks', async () => {
    const getWslInstallStatus = vi
      .fn()
      .mockResolvedValue({ supported: true, state: 'installed', pathConfigured: true })
    vi.stubGlobal('window', {
      api: {
        cli: {
          getInstallStatus: vi.fn(),
          getWslInstallStatus,
          installWsl: vi.fn()
        },
        shell: { openPath: vi.fn() }
      }
    })

    renderToStaticMarkup(
      <CliSection
        currentPlatform="win32"
        settings={{
          ...getDefaultSettings('/tmp'),
          localAgentRuntime: 'host',
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' }
        }}
        wslSupportedPlatform
        wslAvailable
        wslCapabilitiesLoading={false}
      />
    )

    await capturedPanel.props?.onBeforeOpenTerminal()

    expect(capturedPanel.useInstalledAgentSkill).toHaveBeenCalledWith(
      'orca-cli',
      expect.objectContaining({
        discoveryTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' },
        sourceKinds: ['global']
      })
    )
    expect(capturedPanel.props?.command).toBe(ORCA_CLI_SKILL_INSTALL_COMMAND)
    expect(capturedPanel.props?.installedCommand).toBe(ORCA_CLI_SKILL_UPDATE_COMMAND)
    expect(capturedPanel.props?.terminalRuntime).toEqual({
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      label: 'WSL Ubuntu'
    })
    const prerequisiteRuntime = capturedPanel.props?.prerequisiteRuntime
    expect(prerequisiteRuntime?.agentRuntime).toEqual(capturedPanel.props?.terminalRuntime)
    expect(prerequisiteRuntime && getOrcaCliInstallTargetKey(prerequisiteRuntime)).toBe(
      'wsl:Ubuntu'
    )
    expect(getWslInstallStatus).toHaveBeenCalledWith({ distro: 'Ubuntu' })
    expect(getWslInstallStatus).toHaveBeenCalledTimes(1)
  })

  it('re-reads its registration toggle when another surface registers the CLI', async () => {
    const hostStatus = {
      platform: 'darwin',
      commandName: 'orca',
      commandPath: '/usr/local/bin/orca',
      pathDirectory: '/usr/local/bin',
      pathConfigured: true,
      launcherPath: null,
      installMethod: 'symlink',
      supported: true,
      currentTarget: null,
      unsupportedReason: null,
      detail: null
    }
    const getInstallStatus = vi
      .fn()
      .mockResolvedValueOnce({ ...hostStatus, state: 'not_installed', commandPath: null })
      .mockResolvedValue({ ...hostStatus, state: 'installed' })
    Object.assign(window, {
      api: {
        cli: { getInstallStatus, getWslInstallStatus: vi.fn(), install: vi.fn(), remove: vi.fn() },
        shell: { openPath: vi.fn() }
      }
    })

    render(<CliSection currentPlatform="darwin" settings={getDefaultSettings('/tmp')} />)
    const registrationSwitch = screen.getByRole('switch')
    await waitFor(() => expect(registrationSwitch.getAttribute('aria-checked')).toBe('false'))
    await waitFor(() => expect(registrationSwitch.hasAttribute('disabled')).toBe(false))
    expect(getInstallStatus).toHaveBeenCalledTimes(1)

    act(() => notifyOrcaCliInstallStateChanged())

    await waitFor(() => expect(registrationSwitch.getAttribute('aria-checked')).toBe('true'))
    expect(getInstallStatus).toHaveBeenCalledTimes(2)
  })

  it('renders an inline unknown PATH state without offering a mutation', async () => {
    const getInstallStatus = vi.fn().mockResolvedValue({
      platform: 'win32',
      commandName: 'orca',
      commandPath: 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe',
      pathDirectory: 'C:\\Program Files\\Orca\\resources\\bin',
      pathConfigured: null,
      launcherPath: 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe',
      installMethod: 'wrapper',
      supported: true,
      state: 'installed',
      currentTarget: 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe',
      unsupportedReason: null,
      detail: 'Orca could not read the Windows user PATH registry value.'
    })
    Object.assign(window, {
      api: {
        cli: {
          getInstallStatus,
          getWslInstallStatus: vi.fn(),
          install: vi.fn(),
          remove: vi.fn()
        },
        shell: { openPath: vi.fn() }
      }
    })

    render(<CliSection currentPlatform="win32" settings={getDefaultSettings('/tmp')} />)

    expect(await screen.findByText(/could not read the Windows user PATH/i)).toBeDefined()
    const registrationSwitch = screen.getByRole('switch') as HTMLButtonElement
    expect(registrationSwitch.disabled).toBe(true)
    expect(registrationSwitch.getAttribute('aria-checked')).toBe('false')
    expect(toastError).not.toHaveBeenCalled()
  })
})
