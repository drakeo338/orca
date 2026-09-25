import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowsProcessIdentityRow } from '../windows/windows-process-table'
import { confirmShellForegroundProcess } from './agent-foreground-process'

const LAUNCHER = 'C:\\Program Files\\Git\\bin\\bash.exe'
const MSYS_BASH = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
const LAUNCHER_PID = 100
const HAND_OFF_PID = 101

// Measured on Git for Windows: an idle launcher pane's job is [launcher, usr\bin\bash].
const IDLE_ROWS: WindowsProcessIdentityRow[] = [
  { pid: LAUNCHER_PID, ppid: 50, name: 'bash.exe' },
  { pid: HAND_OFF_PID, ppid: LAUNCHER_PID, name: 'bash.exe' }
]

function confirm(
  shellPath: string,
  jobProcessIds: number[],
  rows: WindowsProcessIdentityRow[] | Error = IDLE_ROWS
): { result: Promise<boolean>; readIdentityTable: ReturnType<typeof vi.fn> } {
  const readIdentityTable = vi.fn(async () => {
    if (rows instanceof Error) {
      throw rows
    }
    return rows
  })
  const result = confirmShellForegroundProcess(LAUNCHER_PID, shellPath, {
    readWindowsPtyJobProcessIds: async () => new Set(jobProcessIds),
    readWindowsProcessIdentityTable: readIdentityTable
  })
  return { result, readIdentityTable }
}

describe('Windows shell proof for the Git Bash launcher', () => {
  let platform: PropertyDescriptor | undefined

  beforeEach(() => {
    platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  })

  afterEach(() => {
    if (platform) {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('confirms an idle prompt whose job is the launcher and its bash hand-off', async () => {
    await expect(confirm(LAUNCHER, [LAUNCHER_PID, HAND_OFF_PID]).result).resolves.toBe(true)
  })

  it('refutes while a command runs under the MSYS bash', async () => {
    const rows = [...IDLE_ROWS, { pid: 102, ppid: HAND_OFF_PID, name: 'vim.exe' }]
    await expect(confirm(LAUNCHER, [LAUNCHER_PID, HAND_OFF_PID, 102], rows).result).resolves.toBe(
      false
    )
  })

  it("refutes a second member that is not the launcher's bash child", async () => {
    await expect(
      confirm(
        LAUNCHER,
        [LAUNCHER_PID, HAND_OFF_PID],
        [IDLE_ROWS[0], { pid: HAND_OFF_PID, ppid: LAUNCHER_PID, name: 'node.exe' }]
      ).result
    ).resolves.toBe(false)
    await expect(
      confirm(
        LAUNCHER,
        [LAUNCHER_PID, HAND_OFF_PID],
        [IDLE_ROWS[0], { pid: HAND_OFF_PID, ppid: 999, name: 'bash.exe' }]
      ).result
    ).resolves.toBe(false)
    await expect(
      confirm(LAUNCHER, [LAUNCHER_PID, HAND_OFF_PID], [IDLE_ROWS[0]]).result
    ).resolves.toBe(false)
  })

  it('never reads the table for a shell that is not the launcher', async () => {
    // A forked subshell of a directly launched MSYS bash has the same shape as the hand-off.
    const direct = confirm(MSYS_BASH, [LAUNCHER_PID, HAND_OFF_PID])
    await expect(direct.result).resolves.toBe(false)
    expect(direct.readIdentityTable).not.toHaveBeenCalled()

    const powershell = confirm('powershell.exe', [LAUNCHER_PID, HAND_OFF_PID])
    await expect(powershell.result).resolves.toBe(false)
    expect(powershell.readIdentityTable).not.toHaveBeenCalled()
  })

  it('confirms a launcher alone in its job without reading the table', async () => {
    const alone = confirm(LAUNCHER, [LAUNCHER_PID])
    await expect(alone.result).resolves.toBe(true)
    expect(alone.readIdentityTable).not.toHaveBeenCalled()
  })

  it('fails closed when the process table cannot be read', async () => {
    await expect(
      confirm(LAUNCHER, [LAUNCHER_PID, HAND_OFF_PID], new Error('snapshot unavailable')).result
    ).resolves.toBe(false)
  })

  it('refutes a job that does not contain the launcher', async () => {
    await expect(confirm(LAUNCHER, [HAND_OFF_PID, 102]).result).resolves.toBe(false)
  })
})
