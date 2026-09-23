import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { selectFloatingVisibleTabCount } from '@/store/selectors'
import type { Tab } from '../../../../shared/tab-types'
import type { FloatingTerminalPanelStoreState } from './use-floating-terminal-panel-store-state'

type FloatingTerminalPanelItemsInput = Pick<
  FloatingTerminalPanelStoreState,
  'tabs' | 'browserTabs' | 'groups' | 'unifiedTabs' | 'floatingFiles' | 'activeGroupId'
>

/** The id a tab strip addresses a tab by: terminals and browsers by entity, the rest by tab. */
function visibleTabId(tab: Tab): string {
  return tab.contentType === 'terminal' || tab.contentType === 'browser' ? tab.entityId : tab.id
}

/**
 * What the floating panel's shortcuts and focus act on. The panel renders every group through the
 * shared workspace surface; this is only the focused group — the one a keystroke means.
 */
export function useFloatingTerminalPanelItems({
  tabs,
  browserTabs,
  groups,
  unifiedTabs,
  floatingFiles,
  activeGroupId
}: FloatingTerminalPanelItemsInput) {
  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null,
    [activeGroupId, groups]
  )
  const groupTabs = useMemo(
    () => (activeGroup ? unifiedTabs.filter((tab) => tab.groupId === activeGroup.id) : unifiedTabs),
    [activeGroup, unifiedTabs]
  )
  const activeTab = useMemo(
    () =>
      (activeGroup?.activeTabId
        ? groupTabs.find((tab) => tab.id === activeGroup.activeTabId)
        : null) ??
      groupTabs[0] ??
      null,
    [activeGroup, groupTabs]
  )
  const activeTerminalId = activeTab?.contentType === 'terminal' ? activeTab.entityId : null
  const visibleFloatingItemCount = useAppStore(selectFloatingVisibleTabCount)
  const hasVisibleFloatingTabs = visibleFloatingItemCount > 0
  const activeClosableTab = hasVisibleFloatingTabs ? activeTab : null
  // Why the backing-record check: the strip hides a tab whose record is gone, so an index shortcut
  // counting it would land one tab off.
  const visibleFloatingTabOrder = useMemo(() => {
    const terminalIds = new Set(tabs.map((tab) => tab.id))
    const browserIds = new Set(browserTabs.map((tab) => tab.id))
    const fileIds = new Set(floatingFiles.map((file) => file.id))
    const hasBackingRecord = (tab: Tab): boolean =>
      tab.contentType === 'terminal'
        ? terminalIds.has(tab.entityId)
        : tab.contentType === 'browser'
          ? browserIds.has(tab.entityId)
          : tab.contentType === 'simulator' || tab.contentType === 'agent-session'
            ? true
            : fileIds.has(tab.entityId)
    return (activeGroup?.tabOrder ?? []).flatMap((tabId) => {
      const tab = groupTabs.find((candidate) => candidate.id === tabId)
      return tab && hasBackingRecord(tab) ? [visibleTabId(tab)] : []
    })
  }, [activeGroup, browserTabs, floatingFiles, groupTabs, tabs])
  const activeTabType = activeTab?.contentType ?? null

  return {
    activeGroup,
    groupTabs,
    activeTab,
    activeTerminalId,
    hasVisibleFloatingTabs,
    visibleFloatingItemCount,
    activeClosableTab,
    visibleFloatingTabOrder,
    activeTabType
  }
}

export type FloatingTerminalPanelItems = ReturnType<typeof useFloatingTerminalPanelItems>
