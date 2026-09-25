import { applyBackgroundMountTabRestriction } from './background-terminal-worktree-mount'

/** A hold is the one restriction shape nothing else produces: no admitted tabs and no
 *  deferral entry. Prune drops an emptied targeted restriction outright, and an activation
 *  restriction emptied by closes keeps its deferral entry. */
function isStartupTerminalTabHold(
  restrictions: ReadonlyMap<string, ReadonlySet<string>>,
  deferredMountTabIdsByWorktree: ReadonlyMap<string, ReadonlySet<string>>,
  worktreeId: string
): boolean {
  return restrictions.get(worktreeId)?.size === 0 && !deferredMountTabIdsByWorktree.has(worktreeId)
}

/**
 * Keeps every terminal tab of the active worktree unmounted while startup restoration is
 * still publishing PTY ownership, so the workspace surface can mount from the hydrated tab
 * model without a pane binding a PTY early. Must run before the worktree joins
 * `mountedWorktreeIds`, like any restriction.
 *
 * Why an empty admitted set and no deferral entry: reveal and idle admission act only on
 * worktrees with a deferral entry, and prune leaves an unchanged restriction alone, so the
 * hold survives every render pass until the startup gate opens and the activation plan
 * replaces it. A targeted background mount that lands meanwhile widens the hold to its
 * tabs, exactly as it would widen any restriction. Holds on other worktrees are released —
 * nothing was mounted under them — so a workspace switched away from mid-startup returns
 * to the unmounted world where parked watchers cover it.
 */
export function holdTerminalTabsForStartup(
  restrictions: Map<string, ReadonlySet<string>>,
  deferredMountTabIdsByWorktree: ReadonlyMap<string, ReadonlySet<string>>,
  mountedWorktreeIds: Set<string>,
  worktreeId: string
): void {
  for (const [heldWorktreeId] of restrictions) {
    if (
      heldWorktreeId !== worktreeId &&
      isStartupTerminalTabHold(restrictions, deferredMountTabIdsByWorktree, heldWorktreeId)
    ) {
      restrictions.delete(heldWorktreeId)
      mountedWorktreeIds.delete(heldWorktreeId)
    }
  }
  applyBackgroundMountTabRestriction(restrictions, mountedWorktreeIds, worktreeId, [])
}
