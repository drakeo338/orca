// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import { _orcaCliInstallStatusStoreForTests } from '@/hooks/use-orca-cli-install-status'
import { BROWSER_USE_ENABLED_STORAGE_KEY } from '@/lib/browser-use-setup-state'
import { BrowserUseSetup } from './BrowserUsePane'

const storeState = vi.hoisted(() => ({
  settingsSearchQuery: '',
  browserSessionProfiles: [],
  fetchBrowserSessionProfiles: async (): Promise<void> => {},
  browserSessionImportState: null
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() }
}))
vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))
vi.mock('@/hooks/use-active-skill-discovery-runtime-target', () => ({
  useActiveSkillDiscoveryRuntimeTarget: () => ({ kind: 'local' })
}))
vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({ installDisabledReason: null })
}))
vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: [],
  useInstalledAgentSkill: () => ({
    installed: true,
    loading: false,
    error: null,
    refresh: async () => true
  })
}))
vi.mock('./BrowserUseSkillStep', () => ({ BrowserUseSkillStep: () => null }))
vi.mock('./BrowserUseCookieImportStep', () => ({ BrowserUseCookieImportStep: () => null }))
vi.mock('./BrowserUseExamples', () => ({ BrowserUseExamples: () => null }))
vi.mock('./BrowserUseComputerUseNotice', () => ({ BrowserUseComputerUseNotice: () => null }))
vi.mock('./BrowserUseEnableSwitch', () => ({ BrowserUseEnableSwitch: () => null }))

const getInstallStatus = vi.fn<() => Promise<CliInstallStatus>>()
let root: Root | null = null
let container: HTMLDivElement | null = null

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) {
      await Promise.resolve()
    }
  })
}

function cliStepButton(): HTMLButtonElement | undefined {
  return Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
    ['Fix PATH', 'Enable', 'Enabled'].includes(button.textContent?.trim() ?? '')
  )
}

beforeEach(() => {
  _orcaCliInstallStatusStoreForTests.reset()
  getInstallStatus.mockReset()
  localStorage.setItem(BROWSER_USE_ENABLED_STORAGE_KEY, '1')
  Reflect.set(window, 'api', { cli: { getInstallStatus, install: vi.fn() } })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  localStorage.removeItem(BROWSER_USE_ENABLED_STORAGE_KEY)
  Reflect.deleteProperty(window, 'api')
})

describe('BrowserUseSetup CLI step', () => {
  it('shows the CLI as enabled when Enable finds it already on PATH', async () => {
    getInstallStatus.mockResolvedValue(
      cliStatus({ pathConfigured: false, detail: '/usr/local/bin is not on PATH.' })
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<BrowserUseSetup />)
    })
    await flush()
    expect(cliStepButton()?.textContent?.trim()).toBe('Fix PATH')

    // The user fixed PATH in a terminal inside Orca, so no focus event re-read it.
    getInstallStatus.mockResolvedValue(cliStatus())
    await act(async () => {
      cliStepButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(cliStepButton()?.textContent?.trim()).toBe('Enabled')
  })
})
