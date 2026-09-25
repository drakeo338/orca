import { describe, expect, it, vi } from 'vitest'
import { PROCESS_BOUNDARY_GROUND } from '../../shared/terminal-mode-reset-profiles'
import { Session } from './session'
import { TerminalShellLifecycleScanner } from './terminal-shell-lifecycle-scanner'
import type { SubprocessHandle } from './session-subprocess-handle'

// Why this suite: a normal-buffer program that arms input modes and dies used
// to be cleaned only in the renderer, so the daemon kept the stale modes.

const COMMAND_START = '\x1b]133;C\x07'
const COMMAND_DONE = '\x1b]133;D;1\x07'

function triggers(scanner: TerminalShellLifecycleScanner, chunk: string): boolean {
  return scanner.scan(chunk).uncleanDeathTriggerEnd !== undefined
}

describe('armed input modes arm the unclean-death trigger', () => {
  it.each([
    ['mouse protocol and SGR encoding', '\x1b[?1003h\x1b[?1006h'],
    ['focus reporting', '\x1b[?1004h'],
    ['a kitty keyboard push', '\x1b[>1u'],
    ['application keypad', '\x1b[?66h']
  ])('triggers when a normal-buffer program dies with %s armed', (_label, arm) => {
    const scanner = new TerminalShellLifecycleScanner()
    const chunk = `${COMMAND_START}${arm}PROGRAM${COMMAND_DONE}$ `

    const events = scanner.scan(chunk)

    expect(events.uncleanDeathTriggerEnd).toBe(chunk.length - '$ '.length)
  })

  it('never triggers for modes a shell prompt arms itself', () => {
    const scanner = new TerminalShellLifecycleScanner()

    expect(triggers(scanner, `\x1b[?2004h\x1b[?1h\x1b=$ ${COMMAND_START}ls${COMMAND_DONE}`)).toBe(
      false
    )
    expect(triggers(scanner, `\x1b[?2004h\x1b[?1h$ ${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
  })

  it('does not trigger when the program disarms its modes before exiting', () => {
    const scanner = new TerminalShellLifecycleScanner()
    const chunk = `${COMMAND_START}\x1b[?1003h\x1b[?1006h\x1b[>1uRUN\x1b[?1003l\x1b[?1006l\x1b[<u${COMMAND_DONE}`

    expect(triggers(scanner, chunk)).toBe(false)
  })

  it('stays one-shot until a fresh enable', () => {
    const scanner = new TerminalShellLifecycleScanner()

    expect(triggers(scanner, `${COMMAND_START}\x1b[?1004hRUN${COMMAND_DONE}`)).toBe(true)
    // A refuted proof leaves ?1004 armed; later prompts must not pause again.
    expect(triggers(scanner, `$ ${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
    expect(triggers(scanner, `$ ${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
    expect(triggers(scanner, `$ ${COMMAND_START}\x1b[?1000hRUN${COMMAND_DONE}`)).toBe(true)
  })

  it('treats modes the prompt armed before the command started as shell-owned', () => {
    // Synthetic fish-style prompt (no fish transcript on this host): the shell
    // arms focus and kitty at its prompt and leaves them armed across commands.
    const scanner = new TerminalShellLifecycleScanner()
    const prompt = '\x1b[?1004h\x1b[>5u$ '

    expect(triggers(scanner, `${prompt}${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
    expect(triggers(scanner, `${prompt}${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
    expect(triggers(scanner, `${prompt}${COMMAND_START}\x1b[?1002hRUN${COMMAND_DONE}`)).toBe(true)
  })

  it('tracks kitty flags per screen like xterm, so a clean alt exit leaves none armed', () => {
    const scanner = new TerminalShellLifecycleScanner()

    expect(
      triggers(scanner, `$ ${COMMAND_START}\x1b[?1049h\x1b[>1uTUI\x1b[?1049l${COMMAND_DONE}`)
    ).toBe(false)
    // The shell prompt's own main-screen flags survive a TUI's alt round trip.
    expect(
      triggers(
        scanner,
        `\x1b[>5u$ ${COMMAND_START}\x1b[?1049h\x1b[>1uTUI\x1b[?1049l${COMMAND_DONE}`
      )
    ).toBe(false)
  })

  it('still triggers when a TUI dies on the alt screen with its kitty flags pushed', () => {
    const scanner = new TerminalShellLifecycleScanner()

    expect(triggers(scanner, `$ ${COMMAND_START}\x1b[?1049h\x1b[>1uTUI${COMMAND_DONE}`)).toBe(true)
  })

  it('bounds the kitty stack so the ground can always clear it', () => {
    const scanner = new TerminalShellLifecycleScanner()
    // Uncapped, 101 pushes outlast the ground's pop-99, so a later pop would restore flags 5.
    scanner.scan(`${COMMAND_START}${'\x1b[>5u'.repeat(101)}RUN`)
    scanner.scan(PROCESS_BOUNDARY_GROUND)

    expect(triggers(scanner, `\x1b[?1000h\x1b[?1000l\x1b[<uRUN${COMMAND_DONE}`)).toBe(false)
  })

  it('stays inert for the ground: it clears the armed set without re-arming', () => {
    const scanner = new TerminalShellLifecycleScanner()
    scanner.seedOwner('shell')
    expect(triggers(scanner, `${COMMAND_START}\x1b[?1003h\x1b[>1uRUN${COMMAND_DONE}`)).toBe(true)
    const generation = scanner.generation

    expect(triggers(scanner, PROCESS_BOUNDARY_GROUND)).toBe(false)
    expect(scanner.generation).toBe(generation)
    expect(triggers(scanner, `$ ${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
  })

  it('re-asserts only the modes armed at command start, as shell-owned and without a new owner', () => {
    const scanner = new TerminalShellLifecycleScanner()
    scanner.seedOwner('shell')
    const prompt = `\x1b[?1004h\x1b[>5u$ ${COMMAND_START}`
    expect(triggers(scanner, `${prompt}\x1b[?1003h\x1b[>1uRUN${COMMAND_DONE}`)).toBe(true)
    triggers(scanner, PROCESS_BOUNDARY_GROUND)
    const generation = scanner.generation

    expect(scanner.reassertCommandBaseline()).toBe('\x1b[?1004h\x1b[>5u')
    expect(scanner.generation).toBe(generation)
    expect(triggers(scanner, `$ ${COMMAND_START}ls${COMMAND_DONE}`)).toBe(false)
  })
})

function createSubprocess(confirmed: boolean) {
  let onData: ((data: string) => void) | null = null
  const confirmShellForeground = vi.fn(async () => confirmed)
  const handle: SubprocessHandle = {
    pid: 999,
    getForegroundProcess: () => null,
    confirmShellForeground,
    write: () => {},
    resize: () => {},
    kill: () => {},
    forceKill: () => {},
    signal: () => {},
    terminateOwnedTree: () => 'unavailable',
    onData(cb) {
      onData = cb
    },
    onExit() {},
    dispose: () => {}
  }
  return {
    handle,
    confirmShellForeground,
    emit: (data: string) => onData?.(data)
  }
}

async function runNormalBufferDeath(confirmed: boolean) {
  const sub = createSubprocess(confirmed)
  const session = new Session({
    sessionId: `armed-${confirmed}`,
    cols: 80,
    rows: 24,
    subprocess: sub.handle,
    shellReadySupported: false
  })
  sub.emit(`$ run\r\n${COMMAND_START}\x1b[?1003h\x1b[?1006h\x1b[?1004hPROGRAM\r\n${COMMAND_DONE}$ `)
  await vi.waitFor(() => expect(sub.confirmShellForeground).toHaveBeenCalledTimes(1))
  await session.settleShellOwnershipConfirmation()
  const snapshot = session.getSnapshot()
  const records = session.takePendingOutput(false)?.records ?? []
  session.dispose()
  return { snapshot, records }
}

describe('Session grounds a proven normal-buffer death', () => {
  it('records the ground and leaves the daemon emulator with mouse and focus off', async () => {
    const { snapshot, records } = await runNormalBufferDeath(true)

    expect(
      records.some(
        (record) => record.kind === 'output' && record.data.includes(PROCESS_BOUNDARY_GROUND)
      )
    ).toBe(true)
    expect(snapshot?.modes.mouseTracking).toBe(false)
    expect(snapshot?.modes.mouseTrackingMode).toBe('none')
    expect(snapshot?.snapshotAnsi).not.toContain('\x1b[?1004h')
    expect(snapshot?.terminalOwner).toBe('shell')
  })

  it('keeps focus reporting the host armed before the first prompt (ConPTY)', async () => {
    const sub = createSubprocess(true)
    const session = new Session({
      sessionId: 'conpty-focus',
      cols: 80,
      rows: 24,
      subprocess: sub.handle,
      shellReadySupported: false
    })
    sub.emit(
      `\x1b[?1004h\x1b]133;A\x07PS> ${COMMAND_START}\x1b[?1003hPROGRAM\r\n${COMMAND_DONE}PS> `
    )
    await vi.waitFor(() => expect(sub.confirmShellForeground).toHaveBeenCalledTimes(1))
    await session.settleShellOwnershipConfirmation()
    const snapshot = session.getSnapshot()
    const records = session.takePendingOutput(false)?.records ?? []
    session.dispose()

    expect(
      records.some(
        (record) =>
          record.kind === 'output' && record.data.includes(`${PROCESS_BOUNDARY_GROUND}\x1b[?1004h`)
      )
    ).toBe(true)
    expect(snapshot?.modes.mouseTrackingMode).toBe('none')
    expect(snapshot?.snapshotAnsi).toContain('\x1b[?1004h')
    expect(snapshot?.terminalOwner).toBe('shell')
  })

  it('flushes without the ground when the proof is refuted', async () => {
    const { snapshot, records } = await runNormalBufferDeath(false)

    expect(
      records.some(
        (record) => record.kind === 'output' && record.data.includes(PROCESS_BOUNDARY_GROUND)
      )
    ).toBe(false)
    expect(snapshot?.modes.mouseTracking).toBe(true)
    expect(snapshot?.snapshotAnsi).toContain('$ ')
  })

  it('never holds a plain prompt for a proof', async () => {
    const sub = createSubprocess(true)
    const session = new Session({
      sessionId: 'plain-prompt',
      cols: 80,
      rows: 24,
      subprocess: sub.handle,
      shellReadySupported: false
    })
    sub.emit(`\x1b[?2004h\x1b[?1h$ ${COMMAND_START}ls\r\nfile${COMMAND_DONE}\x1b[?2004h$ `)
    await session.settleShellOwnershipConfirmation()

    expect(sub.confirmShellForeground).not.toHaveBeenCalled()
    expect(session.getSnapshot()?.modes.bracketedPaste).toBe(true)
    session.dispose()
  })
})
