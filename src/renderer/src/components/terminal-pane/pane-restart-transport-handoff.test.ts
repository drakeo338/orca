import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installIpcPtyWindow, restorePtySpecWindow } from './pty-transport-test-harness'

const RESTART_STARTUP = {
  command: 'codex',
  startupCommandDelivery: 'shell-ready',
  launchAgent: 'codex'
} as const

describe('releasePaneTransportForRestart', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  beforeEach(() => {
    vi.resetModules()
    installIpcPtyWindow(originalWindow, { data: () => {}, exit: () => {} })
  })

  afterEach(() => {
    restorePtySpecWindow(originalWindow)
  })

  async function attachedTransport(ptyId: string) {
    const { createIpcPtyTransport } = await import('./pty-transport')
    const transport = createIpcPtyTransport({})
    transport.attach({ existingPtyId: ptyId, callbacks: {} })
    return transport
  }

  it('hands the old PTY to the replacement spawn instead of killing it', async () => {
    const { releasePaneTransportForRestart } = await import('./pane-restart-transport-handoff')
    const transport = await attachedTransport('wt1@@old')

    const startup = releasePaneTransportForRestart(transport, RESTART_STARTUP)

    expect(window.api.pty.kill).not.toHaveBeenCalled()
    expect(startup).toEqual({ ...RESTART_STARTUP, replacesPtyId: 'wt1@@old' })

    const { createIpcPtyTransport } = await import('./pty-transport')
    await createIpcPtyTransport({ ...startup, worktreeId: 'wt1' }).connect({
      url: '',
      callbacks: {}
    })
    expect(window.api.pty.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'codex', replacesPtyId: 'wt1@@old' })
    )
  })

  it('keeps kill-then-connect for a remote-runtime PTY whose host ignores the replace field', async () => {
    const { releasePaneTransportForRestart } = await import('./pane-restart-transport-handoff')
    const transport = await attachedTransport('remote:env-1@@term-1')

    const startup = releasePaneTransportForRestart(transport, RESTART_STARTUP)

    expect(startup).toEqual(RESTART_STARTUP)
    expect(window.api.pty.kill).toHaveBeenCalledWith('remote:env-1@@term-1')
  })

  it('never sends a replace field on a session reattach', async () => {
    const { createIpcPtyTransport } = await import('./pty-transport')
    vi.mocked(window.api.pty.spawn).mockResolvedValue({ id: 'wt1@@live', isReattach: true })

    await createIpcPtyTransport({ replacesPtyId: 'wt1@@old' }).connect({
      url: '',
      sessionId: 'wt1@@live',
      callbacks: {}
    })

    expect(window.api.pty.spawn).toHaveBeenCalledWith(
      expect.not.objectContaining({ replacesPtyId: expect.anything() })
    )
  })
})
