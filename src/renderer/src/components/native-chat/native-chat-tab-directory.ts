import type { ExecutionHostId } from '../../../../shared/execution-host'
import { isFloatingWorkspaceId } from '../../../../shared/floating-workspace-worktree'
import { resolveWorkspaceDirectory, type WorkspaceDirectoryState } from '@/lib/workspace-directory'
import type { StructuredSessionWorkspacePath } from '@/store/slices/structured-session-workspace-paths'

export type NativeChatTabDirectoryState = WorkspaceDirectoryState & {
  unifiedTabsByWorktree?: Record<string, readonly { id: string; entityId?: string }[]>
  structuredSessionWorkspacePathByTabId?: Record<string, StructuredSessionWorkspacePath>
}

/**
 * The directory a native chat tab's agent runs in. A floating chat is held to the folder its session
 * was pinned to, because the floating setting can move after launch; every other workspace, and a
 * floating chat whose pin has not arrived, resolves by workspace id exactly as the host does.
 */
export function resolveNativeChatTabDirectory(
  state: NativeChatTabDirectoryState,
  tabId: string,
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): string | null {
  const pinned = state.structuredSessionWorkspacePathByTabId?.[tabId]
  // Why floating and local only: the host re-resolves worktree and folder ids on every launch, and
  // a floating chat never runs off this machine, so no other pin names where the agent runs here.
  if (
    pinned &&
    isFloatingWorkspaceId(worktreeId) &&
    (!executionHostId || executionHostId === 'local') &&
    state.unifiedTabsByWorktree?.[worktreeId]?.some(
      (tab) => tab.id === tabId && tab.entityId === pinned.sessionId
    )
  ) {
    return pinned.workspacePath
  }
  return resolveWorkspaceDirectory(state, worktreeId, executionHostId)
}
