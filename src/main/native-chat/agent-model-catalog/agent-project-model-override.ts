import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

// A listing's default is the account's, but a chat runs in a workspace whose own
// config can pick another model. These checks only look for such config; they
// never read what it picks, so a hit means "name no default", not a model.

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** A `.git` file (linked worktree) or a `.git` directory with a HEAD marks a project root. */
async function isProjectRoot(dir: string): Promise<boolean> {
  const git = join(dir, '.git')
  try {
    const entry = await stat(git)
    return entry.isFile() || (await exists(join(git, 'HEAD')))
  } catch {
    return false
  }
}

/**
 * The directories a chat started in `cwd` reads project config from: each one
 * from the project root (the nearest ancestor holding `.git`, else `cwd`
 * itself) down to `cwd`.
 */
async function projectConfigDirectories(cwd: string): Promise<string[]> {
  const chain: string[] = []
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    chain.push(dir)
    if (await isProjectRoot(dir)) {
      return chain
    }
    if (dirname(dir) === dir) {
      return [resolve(cwd)]
    }
  }
}

async function claudeSettingsNameModel(path: string): Promise<boolean> {
  try {
    const settings: unknown = JSON.parse(await readFile(path, 'utf8'))
    return (
      typeof settings === 'object' &&
      settings !== null &&
      'model' in settings &&
      typeof settings.model === 'string'
    )
  } catch {
    return false
  }
}

async function directoryMayOverride(
  agent: 'claude' | 'codex',
  dir: string,
  accountHomePath: string
): Promise<boolean> {
  if (agent === 'codex') {
    // Codex skips the `.codex` that is its own home; any other one with a config is a layer.
    const layer = join(dir, '.codex')
    return layer !== resolve(accountHomePath) && exists(join(layer, 'config.toml'))
  }
  const results = await Promise.all(
    ['settings.json', 'settings.local.json'].map((name) =>
      claudeSettingsNameModel(join(dir, '.claude', name))
    )
  )
  return results.some(Boolean)
}

/** True when project config for `workspacePath` could make a new chat run a model other than the listed default. */
export async function workspaceMayOverrideDefaultModel(input: {
  agent: 'claude' | 'codex'
  workspacePath: string
  accountHomePath: string
}): Promise<boolean> {
  const dirs = await projectConfigDirectories(input.workspacePath)
  const results = await Promise.all(
    dirs.map((dir) => directoryMayOverride(input.agent, dir, input.accountHomePath))
  )
  return results.some(Boolean)
}
