import { armFloatingPanelReclaimIntent } from '@/lib/floating-workspace-focus-reclaim'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTab, setFloatingTabs } from './floating-terminal-panel-test-fixtures'
import { mocks, setupFloatingTerminalPanelTest } from './floating-terminal-panel-test-harness'
import {
  attachRef,
  findByProp,
  renderPanel,
  runEffects,
  findTitlebarDragSurface,
  makeTitlebarPressTarget
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
  it('refreshes terminal native input focus when the floating panel opens', async () => {
    setFloatingTabs([makeTab({ id: 'tab-1' })])

    await renderPanel(true)
    runEffects()

    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith(
      'tab-1',
      null,
      expect.objectContaining({
        onImeRefocusSkipped: expect.any(Function),
        refreshImeContext: true
      })
    )
    mocks.setFloatingFocus.mockClear()
    mocks.focusTerminalTabSurface.mock.calls[0]?.[2].onImeRefocusSkipped()
    // No refocus target: both bits false (atomic payload, F7).
    expect(mocks.setFloatingFocus).toHaveBeenCalledWith({
      panelFocused: false,
      terminalFocused: false
    })

    const newerFloatingInput = {
      classList: { contains: (token: string) => token === 'xterm-helper-textarea' },
      closest: vi.fn().mockReturnValue({})
    }
    Object.setPrototypeOf(newerFloatingInput, HTMLElement.prototype)
    mocks.focusTerminalTabSurface.mock.calls[0]?.[2].onImeRefocusSkipped(newerFloatingInput)
    // Relatched onto the floating xterm: panel ⊇ terminal, both true.
    expect(mocks.setFloatingFocus).toHaveBeenLastCalledWith({
      panelFocused: true,
      terminalFocused: true
    })
  })

  it('preserves and reclaims terminal input ownership across window blur', async () => {
    setFloatingTabs([makeTab({ id: 'tab-1' })])
    const element = await renderPanel(true)
    const panel = findByProp(element, 'data-floating-terminal-panel')
    const panelElement = { contains: vi.fn().mockReturnValue(true), focus: vi.fn() }
    const terminalInput = {
      blur: vi.fn(),
      classList: { contains: vi.fn((token: string) => token === 'xterm-helper-textarea') },
      closest: vi.fn((selector: string) => {
        if (selector === '[data-floating-terminal-panel]') {
          return panelElement
        }
        return selector === '[data-leaf-id]'
          ? {
              getAttribute: (attribute: string) => (attribute === 'data-leaf-id' ? 'leaf-1' : null)
            }
          : null
      }),
      isConnected: true
    }
    Object.setPrototypeOf(panelElement, HTMLElement.prototype)
    Object.setPrototypeOf(terminalInput, HTMLElement.prototype)
    attachRef(panel.props.ref, panelElement)
    mocks.isTerminalImeInputContextRefreshing.mockReturnValueOnce(true)
    const onBlurCapture = panel.props.onBlurCapture as (event: unknown) => void
    onBlurCapture({
      relatedTarget: null,
      target: terminalInput
    })
    expect(mocks.setFloatingFocus).not.toHaveBeenCalled()
    const documentState = {
      activeElement: terminalInput as unknown as HTMLElement | null,
      addEventListener: vi.fn(),
      body: {} as HTMLElement,
      removeEventListener: vi.fn()
    }
    vi.stubGlobal('document', documentState)
    runEffects()
    const blurListener = vi
      .mocked(window.addEventListener)
      .mock.calls.findLast(([type]) => type === 'blur')?.[1] as (() => void) | undefined
    const focusListener = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'focus')?.[1] as (() => void) | undefined
    if (!blurListener || !focusListener) {
      throw new Error('floating terminal window focus listeners not registered')
    }

    blurListener()
    expect(terminalInput.blur).not.toHaveBeenCalled()

    focusListener()
    expect(mocks.setFloatingFocus).toHaveBeenLastCalledWith({
      panelFocused: true,
      terminalFocused: true
    })

    documentState.activeElement = terminalInput as unknown as HTMLElement
    blurListener()
    documentState.activeElement = documentState.body
    mocks.focusTerminalTabSurface.mockClear()
    focusListener()
    expect(mocks.focusTerminalTabSurface).not.toHaveBeenCalled()

    documentState.activeElement = terminalInput as unknown as HTMLElement
    blurListener()
    terminalInput.isConnected = false
    documentState.activeElement = documentState.body
    focusListener()
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith(
      'tab-1',
      'leaf-1',
      expect.objectContaining({
        onlyIfFocusUnclaimed: true,
        onImeRefocusSkipped: expect.any(Function),
        refreshImeContext: true
      })
    )
  })

  it('focuses the empty floating workspace when opened for immediate shortcuts', async () => {
    const element = await renderPanel(true)
    const panel = findByProp(element, 'data-floating-terminal-panel')
    const panelElement = { focus: vi.fn() }
    attachRef(panel.props.ref, panelElement)

    runEffects()

    expect(panelElement.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('does not crash if the preload focus bridge is stale during dev reload', async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      api: {
        app: {
          getFloatingMarkdownDirectory: mocks.getFloatingMarkdownDirectory,
          getFloatingTerminalCwd: mocks.getFloatingTerminalCwd,
          pickFloatingMarkdownDocument: mocks.pickFloatingMarkdownDocument
        },
        browser: { notifyActiveTabChanged: vi.fn() },
        cli: { getInstallStatus: mocks.getInstallStatus },
        ui: {}
      },
      innerWidth: 1200,
      removeEventListener: vi.fn()
    })

    await renderPanel(false)

    expect(() => runEffects()).not.toThrow()
  })

  it('cancels the pending reclaim frame when the panel root unmounts before it runs', async () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    vi.mocked(window.requestAnimationFrame).mockReturnValue(42)
    setFloatingTabs([makeTab({ id: 'tab-1' })])
    const panelElement = { contains: vi.fn().mockReturnValue(true), focus: vi.fn() }
    const activeElement = { closest: vi.fn().mockReturnValue(panelElement) }
    Object.setPrototypeOf(activeElement, HTMLElement.prototype)
    vi.stubGlobal('document', {
      activeElement,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    const element = await renderPanel(true)
    attachRef(findByProp(element, 'data-floating-terminal-panel').props.ref, panelElement)
    runEffects()

    // The workspace close arms this when a panel-owned close empties the panel.
    armFloatingPanelReclaimIntent()

    // Emptying schedules the reclaim frame (id 42, callback not yet run); unmounting cancels it.
    setFloatingTabs([])
    const emptyElement = await renderPanel(true)
    attachRef(findByProp(emptyElement, 'data-floating-terminal-panel').props.ref, panelElement)
    runEffects()
    attachRef(findByProp(emptyElement, 'data-floating-terminal-panel').props.ref, null)

    // The reclaim frame (42) is canceled on unmount so its deferred focus never runs. (The
    // synchronous empty-panel open-focus effect is orthogonal and not scheduled through this frame.)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
  })

  it('preserves terminal focus when dragging the titlebar from inside the floating panel', async () => {
    setFloatingTabs([makeTab({ id: 'tab-1' })])
    const element = await renderPanel(true)
    const panel = findByProp(element, 'data-floating-terminal-panel')
    const titlebar = findTitlebarDragSurface(element)
    const panelElement = { focus: vi.fn() }
    const activeElement = { closest: vi.fn().mockReturnValue(panelElement) }
    const titlebarTarget = makeTitlebarPressTarget()
    Object.setPrototypeOf(activeElement, HTMLElement.prototype)
    attachRef(panel.props.ref, panelElement)
    vi.stubGlobal('document', { activeElement })

    ;(titlebar.props.onPointerDown as (event: unknown) => void)({
      button: 0,
      clientX: 10,
      clientY: 20,
      currentTarget: { setPointerCapture: vi.fn() },
      pointerId: 1,
      target: titlebarTarget
    })

    expect(panelElement.focus).not.toHaveBeenCalled()
  })

  it('focuses the floating panel for titlebar shortcuts when focus starts outside it', async () => {
    setFloatingTabs([makeTab({ id: 'tab-1' })])
    const element = await renderPanel(true)
    const panel = findByProp(element, 'data-floating-terminal-panel')
    const titlebar = findTitlebarDragSurface(element)
    const panelElement = { focus: vi.fn() }
    const activeElement = { closest: vi.fn().mockReturnValue(null) }
    const titlebarTarget = makeTitlebarPressTarget()
    Object.setPrototypeOf(activeElement, HTMLElement.prototype)
    attachRef(panel.props.ref, panelElement)
    vi.stubGlobal('document', { activeElement })

    ;(titlebar.props.onPointerDown as (event: unknown) => void)({
      button: 0,
      clientX: 10,
      clientY: 20,
      currentTarget: { setPointerCapture: vi.fn() },
      pointerId: 1,
      target: titlebarTarget
    })

    expect(panelElement.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
