import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  storeBox,
  type FloatingPanelStoreState,
  setFloatingLayout
} from './floating-terminal-panel-test-fixtures'
import { mocks, setupFloatingTerminalPanelTest } from './floating-terminal-panel-test-harness'
import {
  findByTypeName,
  flushAsyncWork,
  renderPanel,
  findFloatingTabGroupHost
} from './floating-terminal-panel-render-probe'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  const { createReactHookOverrides } = await import('./floating-terminal-panel-test-module-mocks')
  return { ...actual, ...createReactHookOverrides() }
})

vi.mock('@/store', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createAppStoreModule()
})

vi.mock('@/components/tab-bar/TabBar', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createTabBarModule()
})

vi.mock('@/components/terminal-pane/TerminalPane', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createTerminalPaneModule()
})

vi.mock('@/components/terminal-pane/terminal-parked-tab-watchers', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createParkedTabWatchersModule()
})

vi.mock('@/components/terminal-pane/terminal-ime-input-context-refresh', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createImeInputContextRefreshModule()
})

vi.mock('@/components/terminal/terminal-tab-actions', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createTerminalTabActionsModule()
})

vi.mock('@/store/pinned-tab-close-guard', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createPinnedTabCloseGuardModule()
})

vi.mock('@/components/browser-pane/BrowserPane', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createBrowserPaneModule()
})

vi.mock('@/components/emulator-pane/EmulatorPane', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createEmulatorPaneModule()
})

vi.mock('@/components/editor/EditorPanel', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createEditorPanelModule()
})

vi.mock('@/components/ui/button', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createButtonModule()
})

vi.mock('@/components/contextual-tours/use-contextual-tour', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createContextualTourModule()
})

vi.mock('@/components/ui/dialog', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createDialogModule()
})

vi.mock('@/runtime/web-runtime-session', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createWebRuntimeSessionModule()
})

vi.mock('@/lib/connection-context', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createConnectionContextModule()
})

// Why inline and sync: this module is imported by the test file itself, so an async factory
// resolves too late and the panel ends up calling a second copy of the mock.
vi.mock('@/lib/create-untitled-markdown', () => ({
  createUntitledMarkdownFileWithTemplateSelection: vi.fn()
}))

vi.mock('@/lib/ipc-error', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createIpcErrorModule()
})

vi.mock('sonner', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createSonnerModule()
})

vi.mock('@/lib/focus-terminal-tab-surface', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createFocusTerminalTabSurfaceModule()
})

vi.mock('@/lib/orchestration-setup-state', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createOrchestrationSetupStateModule()
})

vi.mock('./FloatingTerminalOrchestrationDialog', async () => {
  return (
    await import('./floating-terminal-panel-component-stubs')
  ).createOrchestrationDialogModule()
})

vi.mock('./FloatingTerminalResizeHandles', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createResizeHandlesModule()
})

vi.mock('./FloatingTerminalToggleButton', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createToggleButtonModule()
})

vi.mock('./FloatingTerminalWindowControls', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createWindowControlsModule()
})

vi.mock('@/components/ShortcutKeyCombo', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createShortcutKeyComboModule()
})

describe('FloatingTerminalPanel close behavior', () => {
  beforeEach(setupFloatingTerminalPanelTest)

  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('keeps floating browser creation local during active web runtime sessions', async () => {
    ;(storeBox.state as FloatingPanelStoreState).settings.activeRuntimeEnvironmentId = 'runtime-1'
    mocks.isWebRuntimeSessionActive.mockReturnValue(true)
    mocks.createWebRuntimeSessionBrowserTab.mockResolvedValue(true)

    const host = findFloatingTabGroupHost(await renderPanel(true))
    host.newTabActions?.('floating-group').onNewBrowserTab?.()

    expect(mocks.createWebRuntimeSessionBrowserTab).not.toHaveBeenCalled()
    expect(mocks.createBrowserTab).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      'about:blank',
      {
        title: 'New Browser Tab',
        focusAddressBar: true,
        targetGroupId: 'floating-group',
        browserRuntimeEnvironmentId: null
      }
    )
  })

  it('keeps floating terminal creation local during active web runtime sessions', async () => {
    ;(storeBox.state as FloatingPanelStoreState).settings.activeRuntimeEnvironmentId = 'runtime-1'
    mocks.isWebRuntimeSessionActive.mockReturnValue(true)
    mocks.createWebRuntimeSessionTerminal.mockResolvedValue(true)

    const host = findFloatingTabGroupHost(await renderPanel(true))
    host.newTabActions?.('floating-group').onNewTerminalTab?.()
    await flushAsyncWork()

    expect(mocks.createWebRuntimeSessionTerminal).not.toHaveBeenCalled()
    expect(mocks.createTab).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      'floating-group',
      undefined
    )
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('created-tab')
  })

  // Why: with splits, each group's "+" belongs to that group rather than the focused one.
  it('creates a new tab in the group whose strip was used', async () => {
    const host = findFloatingTabGroupHost(await renderPanel(true))

    host.newTabActions?.('right-group').onNewTerminalWithShell?.('zsh')

    expect(mocks.createTab).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      'right-group',
      'zsh'
    )
  })
})

describe('FloatingTerminalPanel workspace surface', () => {
  beforeEach(setupFloatingTerminalPanelTest)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Why: the panel used to render one group by hand, so a tab moved into a split vanished. It now
  // hands the whole layout to the surface every workspace uses.
  it('renders every floating group through the shared workspace surface', async () => {
    const split = {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: 'left' },
      second: { type: 'leaf', groupId: 'right' }
    } as const
    setFloatingLayout(split)

    const surface = findByTypeName(await renderPanel(true), 'WorktreeSplitSurface')

    expect(surface.props).toMatchObject({
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      layout: split,
      isVisible: true,
      acceptsSessionDrops: false
    })
  })

  it('suspends the surface while the panel is closed', async () => {
    const surface = findByTypeName(await renderPanel(false), 'WorktreeSplitSurface')

    expect(surface.props.isVisible).toBe(false)
  })
})
