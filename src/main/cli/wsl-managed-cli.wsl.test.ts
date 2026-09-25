import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { buildWslExecArgs } from '../../shared/wsl-login-shell-command'
import { ensureManagedWslCli } from './wsl-managed-cli'
import { getBashShellReadyRcfileContent } from '../providers/local-pty-shell-ready-bash-rcfile'

// Explicit opt-in: never require a developer's WSL installation for unit tests.
it.skipIf(process.platform !== 'win32' || process.env.ORCA_TEST_MANAGED_WSL !== '1')(
  'executes the managed bridge after startup resets PATH, without guest registration',
  async () => {
    const root = mkdtempSync(join(tmpdir(), "orca WSL's managed CLI "))
    const distro = process.env.ORCA_TEST_WSL_DISTRO || undefined
    const userDataPath = join(root, 'user data 张三')
    const env: Record<string, string> = { ORCA_BACKGROUND_LAUNCH: '1' }
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value
      }
    }
    const wsl = (args: string[]) =>
      runProcess({
        program: 'wsl.exe',
        args: buildWslExecArgs(distro, args),
        env,
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
      const cliEntryPath = join(root, 'out', 'cli', 'index.js')
      mkdirSync(join(root, 'out', 'cli'), { recursive: true })
      writeFileSync(
        cliEntryPath,
        'if(process.argv.includes("--exit"))process.exit(23); console.error("bridge stderr"); console.log(JSON.stringify({argv:process.argv.slice(2),owner:process.env.ORCA_USER_DATA_PATH,handle:process.env.ORCA_TERMINAL_HANDLE}))'
      )
      writeFileSync(join(root, '.bash_profile'), 'export PATH=/usr/bin:/bin\n')
      writeFileSync(join(root, 'rcfile'), getBashShellReadyRcfileContent())
      const translated = await wsl(['wslpath', '-u', root])
      expect(translated.code, translated.stderr).toBe(0)
      const guestRoot = translated.stdout.trim()
      const directory = ensureManagedWslCli({
        commandName: 'orca-dev',
        userDataPath,
        launcherPath: process.execPath,
        cliEntryPath
      })
      expect(directory).not.toBeNull()
      // Mirrors the entries addOrcaWslInteropEnv publishes for a WSL pane.
      Object.assign(env, {
        ORCA_WSL_CLI_DIR: directory ?? '',
        ORCA_CLI_COMMAND: 'orca-dev',
        ORCA_TERMINAL_HANDLE: 'term_managed_fixture',
        WSLENV: 'ORCA_WSL_CLI_DIR/p:ORCA_CLI_COMMAND/u:ORCA_TERMINAL_HANDLE/u'
      })
      const shell = (command: string) =>
        wsl([
          'env',
          `HOME=${guestRoot}`,
          'PATH=/usr/bin:/bin',
          'bash',
          '--rcfile',
          `${guestRoot}/rcfile`,
          '-ic',
          command
        ])

      const result = await shell('orca-dev "two words" "literal $" | cat')
      expect(result.code, result.stderr).toBe(0)
      expect(result.stderr).toContain('bridge stderr')
      expect(result.stdout).toContain('"argv":["two words","literal $"]')
      expect(result.stdout).toContain(JSON.stringify(userDataPath))
      expect(result.stdout).toContain('"handle":"term_managed_fixture"')
      expect((await shell('orca-dev --exit')).code).toBe(23)

      const external = await wsl([
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

      env.ORCA_WSL_CLI_DIR = join(root, 'missing-cli')
      // An unusable CLI warns but never blocks the shell.
      const missing = await shell('echo SHELL_CONTINUED')
      expect(missing.code).toBe(0)
      expect(missing.stdout).toContain('SHELL_CONTINUED')
      expect(missing.stderr).toContain('Check WSL Windows-drive mount options')
      expect((await snapshot()).stdout).toBe(before.stdout)
    } finally {
      await removeTree(root)
    }
  },
  90_000
)
