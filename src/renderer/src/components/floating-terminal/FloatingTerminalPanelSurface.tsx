import { isTerminalImeInputContextRefreshing } from '@/components/terminal-pane/terminal-ime-input-context-refresh'
import { TabGroupHostProvider } from '@/components/tab-group/tab-group-host'
import { WorktreeSplitSurface } from '@/components/TerminalWorktreeSplitSurface'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { renderFloatingTerminalOrchestrationCard } from './FloatingTerminalOrchestrationCard'
import { FloatingTerminalOrchestrationDialog } from './FloatingTerminalOrchestrationDialog'
import { FloatingTerminalResizeHandles } from './FloatingTerminalResizeHandles'
import type { useFloatingTerminalPanelController } from './use-floating-terminal-panel-controller'

const NO_ACTIVITY_TERMINAL_PORTALS: [] = []
// Why an empty set rather than null: it mounts nothing yet, where null would mount everything.
const MOUNT_NOTHING_YET: ReadonlySet<string> = new Set()

export function renderFloatingTerminalPanelSurface({
  open,
  bounds,
  maximized,
  stagedBoundsRef,
  setPanelNode,
  commitUserBounds,
  reportFloatingFocusFromTarget,
  handleShortcutSurfaceKeyDown,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleTitlebarDoubleClick,
  hasVisibleFloatingTabs,
  cwd,
  panelViewportSettled,
  layout,
  activeGroupId,
  tabGroupHost,
  activeTabType,
  showOrchestrationSetup,
  dismissOrchestrationSetup,
  setOrchestrationDialogOpen,
  previewUserBounds,
  orchestrationDialogOpen,
  refreshOrchestrationSetupVisibility
}: ReturnType<typeof useFloatingTerminalPanelController>): React.JSX.Element {
  return (
    // Why: sit above the z-40 notification cards so the floating workspace is
    // never buried behind them, but stay under the z-50 modal layer so its own
    // orchestration dialog (and every app modal) still opens above it.
    // Drop shadow on the outer shell, border on an inner shell — mixing both on
    // one rounded node made corners look stubby. Floating tabs skip their top
    // border so the titlebar curve stays clean.
    <div
      ref={setPanelNode}
      data-floating-terminal-panel
      aria-hidden={!open}
      tabIndex={-1}
      className={`fixed z-[45] flex min-h-[280px] min-w-[420px] rounded-lg bg-transparent text-card-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16),0_24px_64px_rgba(0,0,0,0.32)] outline-none dark:shadow-[0_8px_20px_rgba(0,0,0,0.35),0_28px_72px_rgba(0,0,0,0.58)] ${open ? 'opacity-100' : 'invisible pointer-events-none opacity-0'}`}
      style={{
        visibility: open ? 'visible' : 'hidden',
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      }}
      onMouseUp={(event) => {
        if (maximized || !stagedBoundsRef.current) {
          return
        }
        const rect = event.currentTarget.getBoundingClientRect()
        commitUserBounds({
          ...stagedBoundsRef.current,
          width: rect.width,
          height: rect.height
        })
      }}
      onFocusCapture={(event) => reportFloatingFocusFromTarget(event.target)}
      onBlurCapture={(event) => {
        // Why: keep terminal-first shortcut ownership latched during the
        // synchronous macOS IME refresh blur; refocus or its skip callback settles it.
        if (!isTerminalImeInputContextRefreshing(event.target)) {
          reportFloatingFocusFromTarget(event.relatedTarget)
        }
      }}
      onKeyDownCapture={handleShortcutSurfaceKeyDown}
    >
      {/* Why the drag handlers sit on the whole body: the panel's titlebar is its tab strips, and
          the drag target check only admits their empty chrome. */}
      <div
        className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-black/14 bg-background dark:border-white/14"
        data-contextual-tour-target={
          hasVisibleFloatingTabs ? 'floating-workspace-surface' : undefined
        }
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onDoubleClick={handleTitlebarDoubleClick}
      >
        {layout ? (
          <TabGroupHostProvider value={tabGroupHost}>
            <WorktreeSplitSurface
              worktreeId={FLOATING_TERMINAL_WORKTREE_ID}
              worktreePath={cwd ?? ''}
              layout={layout}
              focusedGroupId={activeGroupId ?? undefined}
              isVisible={open}
              shouldMeasureHiddenWorktree={false}
              shouldColdParkTerminalPanes={false}
              isForceParked={false}
              activityTerminalPortals={NO_ACTIVITY_TERMINAL_PORTALS}
              // Why: a restored-maximized panel derives its rect from the live viewport, so
              // mounting terminals before the window finishes maximizing fits them to a grid it is
              // about to leave, and the correcting fit reflows the buffer under a live TUI.
              backgroundMountTabIds={panelViewportSettled ? null : MOUNT_NOTHING_YET}
              activationDeferredMountTabIds={null}
              // Why: a session resumes into a workspace, and the floating panel is not one it can
              // resume into; its window-level drop handler would also fire beside the main window's.
              acceptsSessionDrops={false}
            />
          </TabGroupHostProvider>
        ) : null}
      </div>
      {renderFloatingTerminalOrchestrationCard({
        visible: showOrchestrationSetup && activeTabType === 'terminal',
        onDismiss: dismissOrchestrationSetup,
        onEnable: () => setOrchestrationDialogOpen(true)
      })}
      {!maximized && (
        <FloatingTerminalResizeHandles
          bounds={bounds}
          onPreviewBounds={previewUserBounds}
          onCommitBounds={commitUserBounds}
        />
      )}
      <FloatingTerminalOrchestrationDialog
        open={orchestrationDialogOpen}
        onOpenChange={setOrchestrationDialogOpen}
        onSetupStateChange={() => void refreshOrchestrationSetupVisibility()}
      />
    </div>
  )
}
