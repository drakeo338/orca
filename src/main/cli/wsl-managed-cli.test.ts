import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { runProcess } from '../../shared/child-process/run-process'
import { applyManagedWslCliEnvironment, ensureManagedWslCli } from './wsl-managed-cli'

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
  return {
    isPackaged: true,
    resourcesPath,
    userDataPath: join(root, 'user data')
  }
}

describe('managed WSL CLI provisioning', () => {
  it('publishes complete identical files from concurrent processes', async () => {
    const options = fixture()
    const bundle = join(options.userDataPath, 'setup.cjs')
    buildSync({
      entryPoints: [join(__dirname, 'wsl-managed-cli.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundle
    })
    const script = `console.log(require(${JSON.stringify(bundle)}).ensureManagedWslCli(${JSON.stringify(options)}))`
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        runProcess({
          program: process.execPath,
          args: ['-e', script],
          env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
        })
      )
    )
    for (const result of results) {
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe(ensureManagedWslCli(options))
    }
  })

  it('reuses a complete tree, repairs missing files, and isolates app identities and updates', () => {
    const options = fixture()
    const directory = ensureManagedWslCli(options)
    expect(directory).not.toBeNull()
    const launcher = join(directory ?? '', 'orca-ide')
    const modified = statSync(launcher).mtimeMs
    expect(ensureManagedWslCli(options)).toBe(directory)
    expect(statSync(launcher).mtimeMs).toBe(modified)
    rmSync(launcher)
    expect(ensureManagedWslCli(options)).toBe(directory)
    expect(readFileSync(launcher, 'utf8')).toContain('resources with spaces')
    const second = {
      ...options,
      userDataPath: join(options.userDataPath, 'second')
    }
    expect(ensureManagedWslCli(second)).not.toBe(directory)
    const update = fixture()
    expect(ensureManagedWslCli({ ...update, userDataPath: options.userDataPath })).not.toBe(
      directory
    )
  })

  it('passes only the managed directory to WSL without changing the host PATH', () => {
    const env = { PATH: 'unchanged', WSLENV: 'KEEP/u:ORCA_WSL_CLI_DIR/u' }
    applyManagedWslCliEnvironment(env, fixture())
    expect(env.PATH).toBe('unchanged')
    expect(env.WSLENV).toBe('KEEP/u:ORCA_WSL_CLI_DIR/p')
  })

  it('clears an inherited directory when the CLI runtime is missing', () => {
    const env: Record<string, string> = { ORCA_WSL_CLI_DIR: 'stale' }
    const options = fixture()
    rmSync(join(options.resourcesPath, 'bin', 'orca.exe'))
    applyManagedWslCliEnvironment(env, options)
    expect(env.ORCA_WSL_CLI_DIR).toBeUndefined()
  })

  it('runs development CLI directly, without a cmd.exe quoting boundary', () => {
    const options = fixture()
    const appPath = options.resourcesPath
    mkdirSync(join(appPath, 'out', 'cli'), { recursive: true })
    writeFileSync(join(appPath, 'out', 'cli', 'index.js'), 'fixture')
    const directory = ensureManagedWslCli({ ...options, isPackaged: false, appPath }) ?? ''
    expect(readFileSync(join(directory, 'orca-dev'), 'utf8')).toContain(process.execPath)
    const bridge = readFileSync(join(directory, 'orca-wsl-bridge.ps1'), 'utf8')
    expect(bridge).toContain("$env:ELECTRON_RUN_AS_NODE = '1'")
    expect(bridge).toContain(options.userDataPath)
    expect(bridge).toContain(join(appPath, 'out', 'cli', 'index.js'))
  })
})
