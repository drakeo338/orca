import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { windowsPowerShellPath } from '../../shared/child-process/windows-system-binary'
import { writeShellWrapperFiles } from '../shell-wrapper-file-writer'
import { getBundledLauncherPath, LINUX_CLI_COMMAND_NAME } from './bundled-cli-launcher-path'
import { DEV_COMMAND_NAME } from './cli-install-constants'
import { buildColocatedWslLauncher, buildWslBridgeScript } from './wsl-cli-scripts'

type ManagedWslCliHost = {
  isPackaged: boolean
  userDataPath: string
  resourcesPath?: string
}

export type ManagedWslCliRuntime = {
  commandName: string
  userDataPath: string
  /** Windows program the bridge starts. */
  launcherPath: string
  /** Development only: the compiled CLI that Electron runs as Node. */
  cliEntryPath?: string
}

/** Same names guest registration installs, so agent guidance is identical either way. */
export function getWslCliCommandName(isPackaged: boolean): string {
  return isPackaged ? LINUX_CLI_COMMAND_NAME : DEV_COMMAND_NAME
}

/** Directory holding this app's WSL launcher, or null when the CLI runtime is missing or unwritable. */
export function getManagedWslCliDir(host: ManagedWslCliHost): string | null {
  const runtime = resolveManagedWslCliRuntime(host)
  if (!runtime) {
    console.warn('[WSL CLI] Orca CLI runtime is missing; WSL terminals will not provide it.')
    return null
  }
  return ensureManagedWslCli(runtime)
}

/**
 * Content-addressed like shell-ready wrappers: builds sharing userData never overwrite
 * each other, and a present file is complete because each one lands by rename.
 */
export function ensureManagedWslCli(runtime: ManagedWslCliRuntime): string | null {
  const launcher = buildColocatedWslLauncher(runtime.launcherPath, windowsPowerShellPath())
  const bridge = buildWslBridgeScript(runtime)
  const digest = createHash('sha256').update(launcher).update(bridge).digest('hex').slice(0, 20)
  const directory = join(runtime.userDataPath, 'wsl-managed-cli', digest)
  const files = [
    [join(directory, runtime.commandName), launcher],
    [join(directory, 'orca-wsl-bridge.ps1'), bridge]
  ] as const
  const ready =
    files.every(([path]) => existsSync(path)) || writeShellWrapperFiles(files, '[WSL CLI]')
  return ready ? directory : null
}

function resolveManagedWslCliRuntime(host: ManagedWslCliHost): ManagedWslCliRuntime | null {
  const commandName = getWslCliCommandName(host.isPackaged)
  const { userDataPath } = host
  if (host.isPackaged) {
    const launcherPath = host.resourcesPath && getBundledLauncherPath('win32', host.resourcesPath)
    return launcherPath && existsSync(launcherPath)
      ? { commandName, userDataPath, launcherPath }
      : null
  }
  // Why: a plain-Node fork or unit test has no app root to run the dev CLI from.
  if (!hasAppEnvironment()) {
    return null
  }
  const cliEntryPath = join(getAppEnvironment().getAppPath(), 'out', 'cli', 'index.js')
  return existsSync(cliEntryPath)
    ? { commandName, userDataPath, launcherPath: process.execPath, cliEntryPath }
    : null
}
