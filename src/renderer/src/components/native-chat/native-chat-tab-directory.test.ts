import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  resolveNativeChatTabDirectory,
  type NativeChatTabDirectoryState
} from './native-chat-tab-directory'

const FLOATING_TAB = { id: 'floating-chat-1', entityId: 'session-1' }
const WORKTREE_TAB = { id: 'worktree-chat-1', entityId: 'session-2' }
const SSH_HOST = 'ssh:box-1'

function state(overrides: Partial<NativeChatTabDirectoryState> = {}): NativeChatTabDirectoryState {
  return {
    floatingWorkspacePath: '/home/me/changed-setting',
    worktreesByRepo: {
      repo: [
        { id: 'wt-1', path: '/repo/worktree', hostId: 'local' },
        { id: 'wt-ssh', path: '/srv/remote/worktree', hostId: SSH_HOST }
      ]
    },
    unifiedTabsByWorktree: {
      [FLOATING_TERMINAL_WORKTREE_ID]: [FLOATING_TAB],
      'wt-1': [WORKTREE_TAB],
      'wt-ssh': [{ id: 'ssh-chat-1', entityId: 'session-3' }]
    },
    structuredSessionWorkspacePathByTabId: {
      [FLOATING_TAB.id]: { sessionId: 'session-1', workspacePath: '/home/me/pinned' }
    },
    ...overrides
  }
}

describe('resolveNativeChatTabDirectory', () => {
  it('answers a floating chat with its pinned folder after the floating setting moved', () => {
    expect(
      resolveNativeChatTabDirectory(state(), FLOATING_TAB.id, FLOATING_TERMINAL_WORKTREE_ID)
    ).toBe('/home/me/pinned')
    expect(
      resolveNativeChatTabDirectory(
        state(),
        FLOATING_TAB.id,
        FLOATING_TERMINAL_WORKTREE_ID,
        'local'
      )
    ).toBe('/home/me/pinned')
  })

  it('falls back to the floating setting when no pin has been published', () => {
    expect(
      resolveNativeChatTabDirectory(
        state({ structuredSessionWorkspacePathByTabId: {} }),
        FLOATING_TAB.id,
        FLOATING_TERMINAL_WORKTREE_ID
      )
    ).toBe('/home/me/changed-setting')
  })

  it('ignores a pin left from a session the tab no longer shows', () => {
    const rebound = state({
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [{ ...FLOATING_TAB, entityId: 'session-new' }]
      }
    })
    expect(
      resolveNativeChatTabDirectory(rebound, FLOATING_TAB.id, FLOATING_TERMINAL_WORKTREE_ID)
    ).toBe('/home/me/changed-setting')
  })

  it('never answers a floating chat off the local host, pinned or not', () => {
    expect(
      resolveNativeChatTabDirectory(
        state(),
        FLOATING_TAB.id,
        FLOATING_TERMINAL_WORKTREE_ID,
        SSH_HOST
      )
    ).toBeNull()
  })

  it('resolves worktree chats by id even when a pin is recorded for the tab', () => {
    const pinned = state({
      structuredSessionWorkspacePathByTabId: {
        [WORKTREE_TAB.id]: { sessionId: 'session-2', workspacePath: '/somewhere/else' },
        'ssh-chat-1': { sessionId: 'session-3', workspacePath: '/somewhere/else' }
      }
    })
    expect(resolveNativeChatTabDirectory(pinned, WORKTREE_TAB.id, 'wt-1')).toBe('/repo/worktree')
    expect(resolveNativeChatTabDirectory(pinned, 'ssh-chat-1', 'wt-ssh', SSH_HOST)).toBe(
      '/srv/remote/worktree'
    )
  })
})
