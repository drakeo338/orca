import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  clearFloatingPanelReclaimIntent,
  consumeFloatingPanelReclaimIntent
} from '@/lib/floating-workspace-focus-reclaim'

const closeTerminalTab = vi.hoisted(() =>
  vi.fn<(tabId: string, options?: { onClosed?: () => void }) => void>()
)
const panel = vi.hoisted(() => ({ focused: true, remaining: 0 }))
const requestEditorFileClose = vi.hoisted(() =>
  vi.fn<(fileId: string, options?: { onClosed?: () => void }) => void>()
)

vi.mock('../terminal/terminal-tab-actions', () => ({ closeTerminalTab }))
vi.mock('@/lib/floating-workspace-terminal-actions', () => ({
  isFloatingWorkspacePanelFocused: () => panel.focused
}))
vi.mock('@/store/selectors', () => ({ selectFloatingVisibleTabCount: () => panel.remaining }))
vi.mock('../editor/editor-autosave', () => ({ requestEditorFileClose }))

import { createWorkspaceTabCloseCommands } from './workspace-tab-close-commands'
import { useAppStore } from '../../store'
import { makeOpenFile } from '../../store/slices/store-test-helpers'

const terminalTab: Tab = {
  id: 'unified-terminal',
  entityId: 'terminal-1',
  groupId: 'floating-group',
  worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
  contentType: 'terminal',
  label: 'Terminal 1',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}

function requestClose(): { land: () => void } {
  createWorkspaceTabCloseCommands({
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    groupTabs: [terminalTab]
  }).closeItem(terminalTab.id)
  const options = closeTerminalTab.mock.calls.at(-1)?.[1]
  return { land: () => options?.onClosed?.() }
}

// Emptying the floating panel from inside it keeps keyboard ownership for the next Cmd/Ctrl+T.
describe('closing the last floating tab', () => {
  beforeEach(() => {
    closeTerminalTab.mockClear()
    clearFloatingPanelReclaimIntent()
    panel.focused = true
    panel.remaining = 0
  })

  it('keeps the panel focus when a panel-owned close lands and empties it', () => {
    requestClose().land()

    expect(consumeFloatingPanelReclaimIntent()).toBe(true)
  })

  it('does not keep focus when another floating tab remains', () => {
    panel.remaining = 1

    requestClose().land()

    expect(consumeFloatingPanelReclaimIntent()).toBe(false)
  })

  // Why: a pinned or running-process close can be cancelled, and then it never lands.
  it('does not keep focus while the close has not landed', () => {
    requestClose()

    expect(consumeFloatingPanelReclaimIntent()).toBe(false)
  })

  // Why: the save prompt takes focus, so ownership must be read before it opens.
  it('keeps the panel focus when an unsaved note closes after its save prompt', () => {
    const noteTab: Tab = {
      ...terminalTab,
      id: 'unified-note',
      entityId: 'note',
      contentType: 'editor'
    }
    useAppStore.setState({
      openFiles: [
        makeOpenFile({ id: 'note', worktreeId: FLOATING_TERMINAL_WORKTREE_ID, isDirty: true })
      ],
      unifiedTabsByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: [noteTab] }
    })
    createWorkspaceTabCloseCommands({
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      groupTabs: [noteTab]
    }).closeItem(noteTab.id)
    const onClosed = requestEditorFileClose.mock.calls.at(-1)?.[1]?.onClosed

    panel.focused = false
    onClosed?.()

    expect(onClosed).toBeDefined()
    expect(consumeFloatingPanelReclaimIntent()).toBe(true)
  })

  // Why: removing the pane blurs it, so ownership must be read when the close is requested.
  it('reads panel ownership when the close is requested, not when it lands', () => {
    panel.focused = false
    const close = requestClose()
    panel.focused = true

    close.land()

    expect(consumeFloatingPanelReclaimIntent()).toBe(false)
  })
})
