import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { isGitForWindowsBashLauncherPath, resolveGitBashPath } from '../git-bash'
import { confirmShellForegroundProcess } from './agent-foreground-process'
import { readWindowsPtyJobProcessIds } from './windows-pty-job-membership'

const describeOnWindows = process.platform === 'win32' ? describe : describe.skip

describeOnWindows('Git Bash launcher shell proof', () => {
  it('confirms an idle launcher pane, refutes a running command, and confirms again', async () => {
    const shell = resolveGitBashPath()
    expect(shell, 'Git for Windows must be installed on the native test runner').not.toBeNull()
    expect(isGitForWindowsBashLauncherPath(shell!)).toBe(true)
    const pty = await import('node-pty')
    const proc = pty.spawn(shell!, ['--noprofile', '--norc', '-i'], {
      cwd: tmpdir(),
      cols: 120,
      rows: 30,
      useConptyDll: true
    })
    const confirm = (): Promise<boolean> =>
      confirmShellForegroundProcess(proc.pid, shell, {
        readWindowsPtyJobProcessIds: () => readWindowsPtyJobProcessIds(proc)
      })
    try {
      await vi.waitFor(async () => expect(await confirm()).toBe(true), { timeout: 15_000 })
      expect(readWindowsPtyJobProcessIds(proc)?.size).toBe(2)

      proc.write('sleep 60\r')
      await vi.waitFor(async () => expect(await confirm()).toBe(false), { timeout: 10_000 })

      proc.write('\x03')
      await vi.waitFor(async () => expect(await confirm()).toBe(true), { timeout: 10_000 })
    } finally {
      proc.kill()
    }
  }, 45_000)
})
