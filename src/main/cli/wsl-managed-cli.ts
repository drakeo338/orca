import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { writeShellWrapperFiles } from '../shell-wrapper-file-writer'
import { getBundledLauncherPath } from './bundled-cli-launcher-path'
import { buildWslBridgeScript, buildWslLauncher } from './wsl-cli-scripts'

type ManagedWslCliOptions = {
  isPackaged: boolean
  userDataPath: string
  resourcesPath?: string | null
  appPath?: string
  execPath?: string
}

/** Files stay in this app's data directory; WSLENV translates their mount for each distro. */
export function ensureManagedWslCli(options: ManagedWslCliOptions): string {
  const cliEntryPath = options.isPackaged
    ? undefined
    : join(options.appPath ?? getAppEnvironment().getAppPath(), 'out', 'cli', 'index.js')
  const launcher = options.isPackaged
    ? options.resourcesPath && getBundledLauncherPath('win32', options.resourcesPath)
    : (options.execPath ?? process.execPath)
  if (!launcher || !existsSync(launcher) || (cliEntryPath && !existsSync(cliEntryPath))) {
    throw new Error('The Orca CLI runtime is missing. Rebuild or reinstall this Orca instance.')
  }
  const commandName = options.isPackaged ? 'orca-ide' : 'orca-dev'
  const launcherScript = buildWslLauncher(launcher, '', {
    windowsPowerShellPath: win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
  })
  const bridge = buildWslBridgeScript({ userDataPath: options.userDataPath, cliEntryPath })
  const digest = createHash('sha256')
    .update(launcherScript)
    .update(bridge)
    .digest('hex')
    .slice(0, 20)
  const directory = join(options.userDataPath, 'wsl-managed-cli', digest)
  const files = [
    [join(directory, commandName), launcherScript],
    [join(directory, 'orca-wsl-bridge.ps1'), bridge]
  ] as const
  const missing = files.filter(([path, content]) => {
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (!stat) {
      return true
    }
    if (!stat.isFile() || readFileSync(path, 'utf8') !== content) {
      throw new Error(
        `Orca CLI file was modified: ${path}. Move it aside and relaunch the terminal.`
      )
    }
    return false
  })
  if (missing.length && !writeShellWrapperFiles(missing, '[WSL CLI]')) {
    throw new Error(
      `Cannot prepare the managed WSL CLI in ${directory}. Check directory permissions.`
    )
  }
  return directory
}

export function applyManagedWslCliEnvironment(
  env: Record<string, string>,
  options: ManagedWslCliOptions
): void {
  delete env.ORCA_WSL_CLI_DIR
  delete env.ORCA_WSL_CLI_ERROR
  try {
    env.ORCA_WSL_CLI_DIR = ensureManagedWslCli(options)
  } catch (error) {
    env.ORCA_WSL_CLI_ERROR = error instanceof Error ? error.message : String(error)
  }
  const entries = (env.WSLENV ?? '').split(':').filter(Boolean)
  for (const entry of ['ORCA_WSL_CLI_DIR/p', 'ORCA_WSL_CLI_ERROR/u']) {
    const key = entry.split('/')[0]
    const index = entries.findIndex((existing) => existing.split('/')[0] === key)
    if (index !== -1) {
      entries.splice(index, 1)
    }
    if (env[key]) {
      entries.push(entry)
    }
  }
  env.WSLENV = entries.join(':')
}
