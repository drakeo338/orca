import { useMemo } from 'react'
import type { TabGroupHost } from '@/components/tab-group/tab-group-host'
import { FloatingTerminalEmptyState } from './FloatingTerminalEmptyState'
import { FloatingTerminalWindowControls } from './FloatingTerminalWindowControls'
import type { FloatingTerminalCreateActions } from './use-floating-terminal-create-actions'
import type { FloatingTerminalPanelFocusReclaim } from './use-floating-terminal-panel-focus-reclaim'
import type { FloatingTerminalPanelItems } from './use-floating-terminal-panel-items'
import type { FloatingTerminalPanelStoreState } from './use-floating-terminal-panel-store-state'
import type { useFloatingTerminalShortcutDetails } from './use-floating-terminal-shortcut-details'

type FloatingWorkspaceTabGroupHostInput = Pick<
  FloatingTerminalCreateActions,
  | 'createFloatingTerminalTab'
  | 'createFloatingBrowserTab'
  | 'createFloatingMarkdownTab'
  | 'openFloatingMarkdownTab'
> &
  Pick<FloatingTerminalPanelItems, 'hasVisibleFloatingTabs'> &
  Pick<FloatingTerminalPanelStoreState, 'managedBrowserCreationEnabled'> &
  Pick<FloatingTerminalPanelFocusReclaim, 'focusPanelForShortcuts'> &
  ReturnType<typeof useFloatingTerminalShortcutDetails> & {
    maximized: boolean
    toggleMaximized: () => void
    onOpenChange: (open: boolean) => void
  }

/** How the floating panel differs from any other workspace: its window controls sit in the tab
 *  strip, its markdown lives in its own notes directory, and it greets an empty panel with a menu. */
export function useFloatingWorkspaceTabGroupHost({
  createFloatingTerminalTab,
  createFloatingBrowserTab,
  createFloatingMarkdownTab,
  openFloatingMarkdownTab,
  hasVisibleFloatingTabs,
  managedBrowserCreationEnabled,
  focusPanelForShortcuts,
  newTerminalShortcut,
  newBrowserShortcut,
  newMarkdownShortcut,
  openMarkdownShortcut,
  closeShortcut,
  maximized,
  toggleMaximized,
  onOpenChange
}: FloatingWorkspaceTabGroupHostInput): TabGroupHost {
  return useMemo(
    () => ({
      headerEnd: (
        <FloatingTerminalWindowControls
          maximized={maximized}
          onToggleMaximized={toggleMaximized}
          onMinimize={() => onOpenChange(false)}
        />
      ),
      tabStripChrome: 'floating-panel',
      // Why: floating markdown is scratch context, not a repo review surface for agent notes.
      markdownAnnotationsEnabled: false,
      // Why whole-workspace: the empty-state element is how a close shortcut knows the panel is
      // empty, so an empty split beside a populated one must not render it.
      emptyGroupBody: hasVisibleFloatingTabs ? undefined : (
        <FloatingTerminalEmptyState
          onNewTerminal={() => createFloatingTerminalTab()}
          onNewMarkdown={() => createFloatingMarkdownTab()}
          onOpenMarkdown={() => openFloatingMarkdownTab()}
          onNewBrowser={() => createFloatingBrowserTab()}
          showNewBrowser={managedBrowserCreationEnabled}
          onClose={() => onOpenChange(false)}
          onFocusPanel={focusPanelForShortcuts}
          newTerminalShortcut={newTerminalShortcut}
          newBrowserShortcut={newBrowserShortcut}
          newMarkdownShortcut={newMarkdownShortcut}
          openMarkdownShortcut={openMarkdownShortcut}
          closeShortcut={closeShortcut}
        />
      ),
      newTabActions: (groupId: string) => ({
        onNewTerminalTab: () => createFloatingTerminalTab(groupId),
        onNewTerminalWithShell: (shell: string) => createFloatingTerminalTab(groupId, shell),
        onNewBrowserTab: () => createFloatingBrowserTab(groupId),
        onNewFileTab: () => createFloatingMarkdownTab(groupId),
        onOpenFileTab: () => openFloatingMarkdownTab(groupId),
        // Why removed: the panel has no project for a simulator or a workspace file picker.
        onNewSimulatorTab: undefined,
        onOpenEntry: undefined,
        newTabMenuOrder: 'markdown-first' as const
      })
    }),
    [
      closeShortcut,
      createFloatingBrowserTab,
      createFloatingMarkdownTab,
      createFloatingTerminalTab,
      focusPanelForShortcuts,
      hasVisibleFloatingTabs,
      managedBrowserCreationEnabled,
      maximized,
      newBrowserShortcut,
      newMarkdownShortcut,
      newTerminalShortcut,
      onOpenChange,
      openFloatingMarkdownTab,
      openMarkdownShortcut,
      toggleMaximized
    ]
  )
}
