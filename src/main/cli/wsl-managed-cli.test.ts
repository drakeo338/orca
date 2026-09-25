import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureManagedWslCli, getManagedWslCliDir } from './wsl-managed-cli'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orca-managed-wsl-'))
  roots.push(root)
  const resourcesPath = join(root, 'resources with spaces')
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
  writeFileSync(join(resourcesPath, 'bin', 'orca.exe'), 'fixture')
  return { isPackaged: true, resourcesPath, userDataPath: join(root, 'user data') }
}

describe('managed WSL CLI provisioning', () => {
  it('reuses a complete tree, repairs missing files, and isolates app identities and updates', () => {
    const host = fixture()
    const directory = getManagedWslCliDir(host) ?? ''
    const launcher = join(directory, 'orca-ide')
    const modified = statSync(launcher).mtimeMs
    expect(getManagedWslCliDir(host)).toBe(directory)
    expect(statSync(launcher).mtimeMs).toBe(modified)
    rmSync(launcher)
    expect(getManagedWslCliDir(host)).toBe(directory)
    expect(readFileSync(launcher, 'utf8')).toContain('resources with spaces')
    const second = { ...host, userDataPath: join(host.userDataPath, 'second') }
    expect(getManagedWslCliDir(second)).not.toBe(directory)
    const update = fixture()
    expect(getManagedWslCliDir({ ...update, userDataPath: host.userDataPath })).not.toBe(directory)
  })

  it('provides nothing when the packaged CLI runtime is missing', () => {
    const host = fixture()
    rmSync(join(host.resourcesPath, 'bin', 'orca.exe'))
    expect(getManagedWslCliDir(host)).toBeNull()
  })

  it('runs the development CLI directly with the dev launcher app-launch env', () => {
    const host = fixture()
    const cliEntryPath = join(host.resourcesPath, 'out', 'cli', 'index.js')
    const directory =
      ensureManagedWslCli({
        commandName: 'orca-dev',
        userDataPath: host.userDataPath,
        launcherPath: process.execPath,
        cliEntryPath
      }) ?? ''
    expect(readFileSync(join(directory, 'orca-dev'), 'utf8')).toContain(process.execPath)
    const bridge = readFileSync(join(directory, 'orca-wsl-bridge.ps1'), 'utf8')
    expect(bridge.startsWith('\uFEFF')).toBe(true)
    expect(bridge).toContain("$env:ELECTRON_RUN_AS_NODE = '1'")
    expect(bridge).toContain('$env:ORCA_APP_EXECUTABLE_NEEDS_APP_ROOT')
    expect(bridge).toContain(host.userDataPath)
    expect(bridge).toContain(cliEntryPath)
  })
})
