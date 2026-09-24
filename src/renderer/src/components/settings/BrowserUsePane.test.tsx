// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_USE_ENABLED_STORAGE_KEY } from '@/lib/browser-use-setup-state'
import { BrowserUseSetup } from './BrowserUsePane'

const captured = vi.hoisted(
  (): { cliStatusRuntimes: unknown[]; prerequisiteRuntimes: unknown[] } => ({
    cliStatusRuntimes: [],
    prerequisiteRuntimes: []
  })
)

const storeState = vi.hoisted(() => ({
  settingsSearchQuery: '',
  browserSessionProfiles: [],
  fetchBrowserSessionProfiles: async (): Promise<void> => {},
  browserSessionImportState: null
}))

const activeSkillRuntime = vi.hoisted(() => ({ installDisabledReason: null }))

vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))
vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => activeSkillRuntime
}))
vi.mock('@/hooks/use-orca-cli-install-status', () => ({
  useOrcaCliInstallStatus: (runtime: unknown) => {
    captured.cliStatusRuntimes.push(runtime)
    return {
      status: null,
      checked: true,
      loading: false,
      registered: false,
      unverifiable: false,
      refresh: () => {}
    }
  }
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
vi.mock('./CliSkillRuntimeSetup', () => ({
  buildSkillCommandForRuntime: (command: string) => command,
  ensureWslCliAvailableForAgentSkillTerminal: async () => null,
  getWslCliDistroRequest: () => undefined
}))
vi.mock('./BrowserUseSkillStep', () => ({
  BrowserUseSkillStep: (props: { prerequisiteRuntime?: unknown }) => {
    captured.prerequisiteRuntimes.push(props.prerequisiteRuntime)
    return null
  }
}))
vi.mock('./BrowserUseCliStep', () => ({ BrowserUseCliStep: () => null }))
vi.mock('./BrowserUseCookieImportStep', () => ({ BrowserUseCookieImportStep: () => null }))
vi.mock('./BrowserUseExamples', () => ({ BrowserUseExamples: () => null }))
vi.mock('./BrowserUseComputerUseNotice', () => ({ BrowserUseComputerUseNotice: () => null }))
vi.mock('./BrowserUseEnableSwitch', () => ({ BrowserUseEnableSwitch: () => null }))

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  captured.cliStatusRuntimes.length = 0
  captured.prerequisiteRuntimes.length = 0
  localStorage.setItem(BROWSER_USE_ENABLED_STORAGE_KEY, '1')
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  localStorage.removeItem(BROWSER_USE_ENABLED_STORAGE_KEY)
})

describe('BrowserUseSetup', () => {
  it('points the skill step notice at the same CLI target as the CLI step', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<BrowserUseSetup />)
    })

    expect(captured.prerequisiteRuntimes.at(-1)).toBe(activeSkillRuntime)
    expect(captured.cliStatusRuntimes.at(-1)).toBe(activeSkillRuntime)
  })
})
