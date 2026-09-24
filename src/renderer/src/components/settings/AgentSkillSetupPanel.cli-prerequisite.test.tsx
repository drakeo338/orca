// @vitest-environment happy-dom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { InstalledAgentSkillState } from '@/hooks/useInstalledAgentSkills'
import { _orcaCliInstallStatusStoreForTests } from '@/hooks/use-orca-cli-install-status'
import { notifyOrcaCliInstallStateChanged } from '@/lib/orca-cli-install-state-event'
import { BrowserUseSkillSetupCard } from '../feature-wall/BrowserUseSkillSetupCard'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import { TooltipProvider } from '../ui/tooltip'

const NOTICE = 'Orca may show a system prompt to register the Orca CLI command on PATH.'

const mocks = vi.hoisted(() => {
  const state: { runtimeTarget: RuntimeClientTarget | null } = { runtimeTarget: { kind: 'local' } }
  return state
})

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  notifyInstalledAgentSkillsChanged: vi.fn(),
  notifyInstalledAgentSkillsRefreshed: vi.fn()
}))
vi.mock('@/hooks/useSkillFreshness', () => ({ refreshSkillFreshness: vi.fn() }))
vi.mock('@/hooks/use-active-skill-discovery-runtime-target', () => ({
  useActiveSkillDiscoveryRuntimeTarget: () => mocks.runtimeTarget
}))
// A fresh object per render, as the real hook can return, so a caller keyed on identity would re-read.
vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({
    installDisabledReason: null,
    terminalShellOverride: undefined,
    canUseLocalSkillFreshness: false
  })
}))
vi.mock('../onboarding/OnboardingInlineCommandTerminal', () => ({
  OnboardingInlineCommandTerminal: (props: { command: string }) => (
    <div data-testid="inline-command-terminal">{props.command}</div>
  )
}))

const getInstallStatus = vi.fn<() => Promise<CliInstallStatus>>()
let now = 1_000_000
let root: Root | null = null
let container: HTMLDivElement | null = null

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

async function renderNode(node: React.ReactNode): Promise<void> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(<TooltipProvider>{node}</TooltipProvider>)
  })
  await flush()
}

function panel(
  overrides: Partial<ComponentProps<typeof AgentSkillSetupPanel>> = {}
): React.JSX.Element {
  return (
    <AgentSkillSetupPanel
      title="CLI skill"
      description="Enables agents to use Orca workflows."
      command="npx skills add orca-cli"
      terminalTitle="CLI skill setup"
      terminalAriaLabel="CLI skill install terminal"
      terminalWorktreeId="settings-cli-skill-terminal"
      installed={false}
      loading={false}
      error={null}
      preInstallNotice={NOTICE}
      onRecheck={vi.fn()}
      {...overrides}
    />
  )
}

function skillState(overrides: Partial<InstalledAgentSkillState> = {}): InstalledAgentSkillState {
  return {
    installed: false,
    loading: false,
    settled: true,
    installedUnverifiable: false,
    error: null,
    skills: [],
    sources: [],
    refresh: vi.fn(async () => false),
    ...overrides
  }
}

function noticeShown(): boolean {
  return container?.textContent?.includes(NOTICE) ?? false
}

beforeEach(() => {
  _orcaCliInstallStatusStoreForTests.reset()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  mocks.runtimeTarget = { kind: 'local' }
  getInstallStatus.mockReset()
  Reflect.set(window, 'api', {
    cli: { getInstallStatus, getWslInstallStatus: vi.fn() },
    ui: { writeClipboardText: vi.fn() },
    platform: { get: () => ({ platform: 'darwin' }) }
  })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  Reflect.deleteProperty(window, 'api')
  Reflect.deleteProperty(globalThis, '__ORCA_WEB_CLIENT__')
  vi.restoreAllMocks()
})

describe('AgentSkillSetupPanel CLI prerequisite notice', () => {
  it('reads the CLI once while a caller re-renders with unrelated prop changes', async () => {
    getInstallStatus.mockResolvedValue(cliStatus({ state: 'not_installed' }))

    for (let render = 0; render < 6; render += 1) {
      await renderNode(
        <BrowserUseSkillSetupCard skill={skillState({ loading: render % 2 === 0 })} />
      )
      // Past every reuse window, so only the absence of a new read can keep the count at one.
      now += 60_000
    }

    expect(getInstallStatus).toHaveBeenCalledTimes(1)
    expect(noticeShown()).toBe(true)
  })

  it('updates the notice when another surface registers the CLI, without a focus event', async () => {
    getInstallStatus.mockResolvedValue(cliStatus({ state: 'not_installed' }))
    await renderNode(panel())
    expect(noticeShown()).toBe(true)

    getInstallStatus.mockResolvedValue(cliStatus())
    await act(async () => {
      notifyOrcaCliInstallStateChanged()
    })
    await flush()

    expect(getInstallStatus).toHaveBeenCalledTimes(2)
    expect(noticeShown()).toBe(false)
  })

  it('hides the notice when this window cannot read the CLI where agents run', async () => {
    getInstallStatus.mockResolvedValue(cliStatus({ state: 'not_installed' }))

    mocks.runtimeTarget = { kind: 'environment', environmentId: 'env-1' }
    await renderNode(panel())
    expect(noticeShown()).toBe(false)

    mocks.runtimeTarget = { kind: 'local' }
    Reflect.set(globalThis, '__ORCA_WEB_CLIENT__', true)
    await renderNode(panel({ title: 'CLI skill (paired)' }))
    expect(noticeShown()).toBe(false)

    expect(getInstallStatus).not.toHaveBeenCalled()
  })

  it('opens the setup terminal without waiting on a CLI status read', async () => {
    getInstallStatus.mockResolvedValue(cliStatus({ state: 'not_installed' }))
    await renderNode(panel())
    getInstallStatus.mockReturnValue(new Promise<CliInstallStatus>(() => {}))

    const install = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Install'
    )
    expect(install).toBeDefined()
    await act(async () => {
      install?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(container?.querySelector('[data-testid="inline-command-terminal"]')).not.toBeNull()
  })
})
