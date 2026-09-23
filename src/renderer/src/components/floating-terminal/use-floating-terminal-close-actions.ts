import { useCallback } from 'react'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { dispatchWorkspaceTabCommand } from '@/lib/workspace-tab-commands'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { FloatingTerminalPanelItems } from './use-floating-terminal-panel-items'

type FloatingTerminalCloseActionsInput = Pick<FloatingTerminalPanelItems, 'groupTabs'>

/** Closes a floating tab through the workspace close every surface uses: pinned guard, running-process
 *  and unsaved-file confirmation, and keeping panel focus when the close empties it. */
export function useFloatingTerminalCloseActions({ groupTabs }: FloatingTerminalCloseActionsInput) {
  const closeFloatingItemConfirmed = useCallback(
    (visibleId: string) => {
      const item = resolveGroupTabFromVisibleId(groupTabs, visibleId)
      if (!item) {
        return
      }
      dispatchWorkspaceTabCommand({
        type: 'close',
        target: { kind: 'tab', worktreeId: FLOATING_TERMINAL_WORKTREE_ID, tabId: item.id }
      })
    },
    [groupTabs]
  )

  return { closeFloatingItemConfirmed }
}

export type FloatingTerminalCloseActions = ReturnType<typeof useFloatingTerminalCloseActions>
