// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_USE_ENABLED_STORAGE_KEY } from '@/lib/browser-use-setup-state'
import { BrowserUseSetup } from './BrowserUsePane'

const captured = vi.hoisted((): { prerequisiteReaders: unknown[] } => ({
  prerequisiteReaders: []
}))

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
  // Why: a fresh object per call mirrors a shared-status publish re-rendering the pane.
  useOrcaCliInstallStatus: () => ({
    status: null,
    checked: true,
    loading: false,
    registered: false,
    unverifiable: false,
    refresh: () => {}
  })
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
  BrowserUseSkillStep: (props: { getPrerequisiteStatus?: unknown }) => {
    captured.prerequisiteReaders.push(props.getPrerequisiteStatus)
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
  captured.prerequisiteReaders.length = 0
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
  it('keeps the skill step CLI reader stable across re-renders so it does not re-read CLI status', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<BrowserUseSetup />)
    })
    await act(async () => {
      root?.render(<BrowserUseSetup />)
    })

    expect(captured.prerequisiteReaders.length).toBeGreaterThanOrEqual(2)
    expect(new Set(captured.prerequisiteReaders).size).toBe(1)
  })
})
