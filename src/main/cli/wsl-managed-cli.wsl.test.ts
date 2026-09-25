import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { buildWslExecArgs, buildWslLoginShellCommand } from '../../shared/wsl-login-shell-command'
import { applyManagedWslCliEnvironment } from './wsl-managed-cli'
import { buildWslLauncher } from './wsl-cli-scripts'
import { getBashShellReadyRcfileContent } from '../providers/local-pty-shell-ready-bash-rcfile'

// Explicit opt-in: never require a developer's WSL installation for unit tests.
it.skipIf(process.platform !== 'win32' || process.env.ORCA_TEST_MANAGED_WSL !== '1')(
  'executes the managed bridge after startup resets PATH, without guest registration',
  async () => {
    const root = mkdtempSync(join(tmpdir(), "orca WSL's managed CLI "))
    const distro = process.env.ORCA_TEST_WSL_DISTRO || undefined
    const env: Record<string, string> = { ORCA_BACKGROUND_LAUNCH: '1' }
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value
      }
    }
    const wsl = (args: string[], input?: string) =>
      runProcess({
        program: 'wsl.exe',
        args: buildWslExecArgs(distro, args),
        env,
        input,
        cwd: root,
        timeoutMs: 30_000
      })
    const snapshot = () =>
      wsl([
        'sh',
        '-c',
        'for file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.local/bin/orca" "$HOME/.local/bin/orca-ide" "$HOME/.local/bin/orca-dev" "$HOME/.local/share/orca/orca-wsl-bridge.ps1"; do if [ -f "$file" ]; then sha256sum "$file"; fi; done; printf "PATH=%s\\n" "$PATH"'
      ])
    try {
      const before = await snapshot()
      expect(before.code, before.stderr).toBe(0)
      mkdirSync(join(root, 'out', 'cli'), { recursive: true })
      writeFileSync(
        join(root, 'out', 'cli', 'index.js'),
        'if(process.argv.includes("--exit"))process.exit(23); console.error("bridge stderr"); console.log(JSON.stringify({argv:process.argv.slice(2),owner:process.env.ORCA_USER_DATA_PATH,cwd:process.env.ORCA_CLI_CWD,handle:process.env.ORCA_TERMINAL_HANDLE}))'
      )
      writeFileSync(join(root, '.bash_profile'), 'export PATH=/usr/bin:/bin\n')
      writeFileSync(join(root, 'rcfile'), getBashShellReadyRcfileContent())
      const translated = await wsl(['wslpath', '-u', root])
      expect(translated.code, translated.stderr).toBe(0)
      const guestRoot = translated.stdout.trim()
      const baseline = await wsl([
        'env',
        `HOME=${guestRoot}`,
        'PATH=/usr/bin:/bin',
        'bash',
        '--noprofile',
        '--norc',
        '-c',
        'command -v orca-dev || exit 42'
      ])
      expect(baseline.code).toBe(42)
      applyManagedWslCliEnvironment(env, {
        isPackaged: false,
        userDataPath: join(root, 'user data'),
        appPath: root,
        execPath: process.execPath
      })
      env.ORCA_TERMINAL_HANDLE = 'term_managed_fixture'
      env.WSLENV += ':ORCA_TERMINAL_HANDLE/u'
      expect(env.ORCA_WSL_CLI_ERROR).toBeUndefined()
      const command = '"$ORCA_CLI_COMMAND" "two words" "literal $" | cat'
      for (const args of [
        ['sh', '-c', buildWslLoginShellCommand(command)],
        ['bash', '--rcfile', `${guestRoot}/rcfile`, '-ic', command]
      ]) {
        const result = await wsl(['env', `HOME=${guestRoot}`, 'PATH=/usr/bin:/bin', ...args])
        expect(result.code, result.stderr).toBe(0)
        expect(() =>
          JSON.parse(result.stdout.slice(result.stdout.indexOf('{"argv"')).trim())
        ).not.toThrow()
        expect(result.stderr).toContain('bridge stderr')
        expect(result.stdout).toContain('"argv":["two words","literal $"]')
        expect(result.stdout).toContain(JSON.stringify(join(root, 'user data')))
        expect(result.stdout).toContain('"handle":"term_managed_fixture"')
      }
      const external = await wsl([
        'env',
        `HOME=${guestRoot}`,
        'PATH=/usr/bin:/bin',
        'env',
        '-u',
        'ORCA_WSL_CLI_DIR',
        'bash',
        '--noprofile',
        '--norc',
        '-c',
        'command -v orca-dev || exit 42'
      ])
      expect(external.code).toBe(42)
      const failed = await wsl([
        'sh',
        '-c',
        buildWslLoginShellCommand('"$ORCA_CLI_COMMAND" --exit')
      ])
      expect(failed.code).toBe(23)
      writeFileSync(
        join(root, 'missing-interop'),
        buildWslLauncher(process.execPath, '', {
          windowsPowerShellPath: join(root, 'missing-powershell.exe')
        })
      )
      const interop = await wsl(['bash', `${guestRoot}/missing-interop`])
      expect(interop.code).toBe(1)
      expect(interop.stderr).toContain('requires Windows interop')
      const unavailable = await runProcess({
        program: 'wsl.exe',
        args: buildWslExecArgs('OrcaMissingDistroFixture-20260924', ['true']),
        env
      })
      expect(unavailable.code).not.toBe(0)
      env.ORCA_WSL_CLI_DIR = join(root, 'missing-cli')
      const missing = await wsl(['sh', '-c', buildWslLoginShellCommand('echo UNEXPECTED_SUCCESS')])
      expect(missing.code).toBe(1)
      expect(missing.stdout).not.toContain('UNEXPECTED_SUCCESS')
      expect(missing.stderr).toContain('Check WSL Windows-drive mounts')
      expect((await snapshot()).stdout).toBe(before.stdout)
    } finally {
      await removeTree(root)
    }
  },
  90_000
)
