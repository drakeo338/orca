import { getClientCreationActionPolicy } from '@/lib/client-creation-action-policy'
import { useAppStore } from '@/store'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { selectFloatingTerminalPanelInputs } from './floating-terminal-panel-inputs'

export function useFloatingTerminalPanelStoreState() {
  const { tabs, browserTabs, groups, unifiedTabs, floatingFiles, expandedPaneByTabId } =
    useAppStore(selectFloatingTerminalPanelInputs)
  const activeGroupId = useAppStore(
    (state) => state.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? null
  )
  const layout = useAppStore(
    (state) => state.layoutByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? null
  )
  const ensureWorktreeRootGroup = useAppStore((state) => state.ensureWorktreeRootGroup)
  const createBrowserTab = useAppStore((state) => state.createBrowserTab)
  const activateTab = useAppStore((state) => state.activateTab)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const openFile = useAppStore((state) => state.openFile)
  const browserDefaultUrl = useAppStore((state) => state.browserDefaultUrl)
  const floatingTerminalCwd = useAppStore((state) => state.settings?.floatingTerminalCwd ?? '')
  // Why the store: native chat resolves floating file/image/skill paths from this same value.
  const cwd = useAppStore((state) => state.floatingWorkspacePath)
  const setCwd = useAppStore((state) => state.setFloatingWorkspacePath)
  const managedBrowserCreationEnabled = useAppStore(
    (state) =>
      getClientCreationActionPolicy(state, FLOATING_TERMINAL_WORKTREE_ID)['managed-browser']
        .state === 'enabled'
  )

  return {
    tabs,
    browserTabs,
    groups,
    unifiedTabs,
    floatingFiles,
    expandedPaneByTabId,
    activeGroupId,
    layout,
    ensureWorktreeRootGroup,
    createBrowserTab,
    activateTab,
    setActiveTab,
    openFile,
    browserDefaultUrl,
    floatingTerminalCwd,
    cwd,
    setCwd,
    managedBrowserCreationEnabled
  }
}

export type FloatingTerminalPanelStoreState = ReturnType<typeof useFloatingTerminalPanelStoreState>
