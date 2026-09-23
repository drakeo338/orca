import type { Tab } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import { requestEditorFileClose } from '../editor/editor-autosave'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { closeWorkspaceBrowserTab } from '@/lib/workspace-browser-tab-close'
import { armFloatingPanelReclaimIntent } from '@/lib/floating-workspace-focus-reclaim'
import { isFloatingWorkspacePanelFocused } from '@/lib/floating-workspace-terminal-actions'
import { selectFloatingVisibleTabCount } from '@/store/selectors'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'

export function createWorkspaceTabCloseCommands({
  worktreeId,
  groupTabs
}: {
  worktreeId: string
  groupTabs: Tab[]
}) {
  const { closeUnifiedTab, closeFile, setActiveWorktree } = useAppStore.getState()

  const closeEditorIfUnreferenced = (entityId: string, closingTabId: string) => {
    const otherReference = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).some(
      (item) =>
        item.id !== closingTabId &&
        item.entityId === entityId &&
        (item.contentType === 'editor' ||
          item.contentType === 'diff' ||
          item.contentType === 'conflict-review' ||
          item.contentType === 'check-details')
    )
    if (!otherReference) {
      const file = useAppStore.getState().openFiles.find((candidate) => candidate.id === entityId)
      if (file?.isDirty) {
        // Why: route through Terminal.tsx so the unsaved-confirmation save/discard queue stays centralized across all close paths.
        requestEditorFileClose(entityId)
        return false
      }
      closeFile(entityId)
    }
    return true
  }

  const leaveWorktreeIfEmpty = () => {
    const state = useAppStore.getState()
    if (state.activeWorktreeId !== worktreeId) {
      return
    }
    // Why: split-group closes bypass legacy Terminal.tsx; deselect the emptied worktree here or the window goes blank instead of landing.
    const { renderableTabCount } = state.reconcileWorktreeTabModel(worktreeId)
    if (renderableTabCount === 0) {
      setActiveWorktree(null)
    }
  }

  // Why per workspace: emptying a worktree leaves it, but the floating panel is never the active
  // worktree — emptying it from inside instead keeps keyboard ownership for the next Cmd/Ctrl+T.
  // Ownership is read when the close is requested: removing the pane blurs it before the close lands.
  const captureEmptiedReaction = (): (() => void) => {
    if (worktreeId !== FLOATING_TERMINAL_WORKTREE_ID) {
      return leaveWorktreeIfEmpty
    }
    const panelOwned = isFloatingWorkspacePanelFocused()
    return () => {
      if (panelOwned && selectFloatingVisibleTabCount(useAppStore.getState()) === 0) {
        armFloatingPanelReclaimIntent()
      }
    }
  }

  const closeItem = (
    itemId: string,
    opts?: { skipEmptyCheck?: boolean; skipRunningProcessConfirm?: boolean }
  ) => {
    const item = groupTabs.find((candidate) => candidate.id === itemId)
    if (!item) {
      return
    }
    const whenEmptied = opts?.skipEmptyCheck ? null : captureEmptiedReaction()
    if (item.contentType === 'agent-session') {
      closeUnifiedTab(item.id)
      whenEmptied?.()
      return
    }
    if (item.contentType === 'terminal') {
      // Why: closeTerminalTab can defer behind a pin / running-process dialog, so the
      // empty check has to run on the actual close — never on cancel.
      closeTerminalTab(item.entityId, {
        ...(opts?.skipRunningProcessConfirm ? { skipRunningProcessConfirm: true } : {}),
        ...(whenEmptied ? { onClosed: whenEmptied } : {})
      })
      return
    }
    if (item.contentType === 'browser') {
      const plan = closeWorkspaceBrowserTab(worktreeId, item.entityId, item.id)
      // Why: the empty check below answers "the user emptied this worktree". Unwinding a create
      // that never finished is not that — it must leave the selection as the click found it.
      if (!plan.closesLocally || plan.localCloseReason === 'cleanup') {
        return
      }
    } else if (item.contentType === 'simulator') {
      closeUnifiedTab(item.id)
    } else {
      const canCloseTab = closeEditorIfUnreferenced(item.entityId, item.id)
      if (!canCloseTab) {
        return
      }
      closeUnifiedTab(item.id)
    }
    whenEmptied?.()
  }

  return { closeItem, leaveWorktreeIfEmpty }
}
