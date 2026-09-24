import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toastErrorMock, subscribeMock, unsubscribeMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn<(title: string, options: { description: string }) => void>(),
  // Typed here so the test can call the captured watcher back without an assertion.
  subscribeMock: vi.fn<(ptyId: string, watcher: (data: string) => void) => void>(),
  unsubscribeMock: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_id: string, fallback: string) => fallback }))
vi.mock('./pty-data-sidecar-subscriptions', () => ({
  subscribeToPtyData: (ptyId: string, watcher: (data: string) => void) => {
    subscribeMock(ptyId, watcher)
    return unsubscribeMock
  }
}))

import { startZCodeMissingTuiWatcher } from './zcode-missing-tui-watcher'

const FIXTURE = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'main',
    'runtime',
    '__fixtures__',
    'zcode-missing-tui.txt'
  ),
  'utf8'
)

function feed(data: string): void {
  const watcher = subscribeMock.mock.calls.at(-1)?.[1]
  if (!watcher) {
    throw new Error('no watcher was registered')
  }
  watcher(data)
}

beforeEach(() => {
  toastErrorMock.mockReset()
  subscribeMock.mockReset()
  unsubscribeMock.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('startZCodeMissingTuiWatcher', () => {
  it('explains the failure when the recorded desktop-bundle output arrives', () => {
    startZCodeMissingTuiWatcher('pty-1')
    feed(FIXTURE)
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock.mock.calls[0][0]).toContain('no terminal UI')
    // Why: the whole point is that Orca's own setup succeeded, so the copy must not
    // leave the user hunting through their hook config.
    expect(toastErrorMock.mock.calls[0][1].description).toContain('hooks installed correctly')
  })

  it('stops listening once it has explained itself', () => {
    startZCodeMissingTuiWatcher('pty-1')
    feed(FIXTURE)
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('rejoins the error when it straddles two chunks', () => {
    startZCodeMissingTuiWatcher('pty-1')
    const split = FIXTURE.indexOf('@zcode') + 3
    feed(FIXTURE.slice(0, split))
    expect(toastErrorMock).not.toHaveBeenCalled()
    feed(FIXTURE.slice(split))
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })

  it('stays silent for a healthy pane and gives up after the startup budget', () => {
    startZCodeMissingTuiWatcher('pty-1')
    // A working ZCode paints its banner; none of it should trip the rule.
    feed('Z'.repeat(9000))
    expect(toastErrorMock).not.toHaveBeenCalled()
    // Why assert the unsubscribe: past the budget the watcher must cost the pane nothing.
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('stays silent when the build has a TUI but no TTY', () => {
    startZCodeMissingTuiWatcher('pty-1')
    feed('TUI requires an interactive terminal.\r\n')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('can be disposed before anything arrives', () => {
    const dispose = startZCodeMissingTuiWatcher('pty-1')
    dispose()
    dispose()
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })
})
