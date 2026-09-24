import { execFile } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { promisify } from 'node:util'
import path from 'node:path'
import { buildRelayCommandEnv } from './relay-command-env'
import {
  defaultGrokHomePath,
  GROK_HOME_PATH_MAX_LENGTH,
  normalizeGrokHomePath
} from '../shared/grok-session-paths'

const execFileAsync = promisify(execFile)
const GROK_HOME_PROBE_TIMEOUT_MS = 8_000

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

export async function resolveGrokHomeForRelay(): Promise<string | null> {
  const fallback = defaultGrokHomePath(homedir())
  try {
    const shell = process.env.SHELL || userInfo().shell || '/bin/sh'
    if (!shell.startsWith('/') || shell.includes('\\') || hasControlCharacter(shell)) {
      return fallback
    }
    const shellName = path.basename(shell)
    const mode = shellName === 'sh' || shellName === 'dash' ? '-c' : '-lc'
    const { stdout } = await execFileAsync(
      shell,
      [mode, `printenv GROK_HOME | head -c ${GROK_HOME_PATH_MAX_LENGTH + 1}`],
      {
        encoding: 'utf-8',
        env: buildRelayCommandEnv(process.env, process.platform),
        timeout: GROK_HOME_PROBE_TIMEOUT_MS
      }
    )
    return normalizeGrokHomePath(stdout.split(/\r?\n/, 1)[0] ?? '') ?? fallback
  } catch {
    return fallback
  }
}
