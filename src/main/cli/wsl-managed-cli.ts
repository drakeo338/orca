import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { applyWslenvPassthrough } from '../pty/wsl-orca-env'
import { writeShellWrapperFiles } from '../shell-wrapper-file-writer'
import { getBundledLauncherPath } from './bundled-cli-launcher-path'
import { buildColocatedWslLauncher, buildWslBridgeScript } from './wsl-cli-scripts'

type ManagedWslCliOptions = {
  isPackaged: boolean
  userDataPath: string
  resourcesPath?: string | null
  appPath?: string
  execPath?: string
}

/**
 * Writes this app's WSL launcher and bridge, or returns null when the CLI runtime is missing
 * or unwritable. Content-addressed like shell-ready wrappers, so builds sharing userData never
 * overwrite each other and an existing tree is complete (each file lands by rename).
 */
export function ensureManagedWslCli(options: ManagedWslCliOptions): string | null {
  const cliEntryPath = options.isPackaged
    ? undefined
    : join(options.appPath ?? getAppEnvironment().getAppPath(), 'out', 'cli', 'index.js')
  const launcher = options.isPackaged
    ? options.resourcesPath && getBundledLauncherPath('win32', options.resourcesPath)
    : (options.execPath ?? process.execPath)
  if (!launcher || !existsSync(launcher) || (cliEntryPath && !existsSync(cliEntryPath))) {
    console.warn('[WSL CLI] Orca CLI runtime is missing; WSL terminals will not provide it.')
    return null
  }
  const powerShellPath = win32.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
  const launcherScript = buildColocatedWslLauncher(launcher, powerShellPath)
  const bridge = buildWslBridgeScript({ userDataPath: options.userDataPath, cliEntryPath })
  const digest = createHash('sha256').update(launcherScript).update(bridge).digest('hex')
  const directory = join(options.userDataPath, 'wsl-managed-cli', digest.slice(0, 20))
  const files = [
    [join(directory, options.isPackaged ? 'orca-ide' : 'orca-dev'), launcherScript],
    [join(directory, 'orca-wsl-bridge.ps1'), bridge]
  ] as const
  const ready =
    files.every(([path]) => existsSync(path)) || writeShellWrapperFiles(files, '[WSL CLI]')
  return ready ? directory : null
}

/** Publishes the launcher directory to WSL guests; the host PATH is left alone. */
export function applyManagedWslCliEnvironment(
  env: Record<string, string>,
  options: ManagedWslCliOptions
): void {
  const directory = ensureManagedWslCli(options)
  if (directory) {
    env.ORCA_WSL_CLI_DIR = directory
  } else {
    delete env.ORCA_WSL_CLI_DIR
  }
  applyWslenvPassthrough(env, ['ORCA_WSL_CLI_DIR/p'])
}
