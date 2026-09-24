import { homedir, userInfo } from 'node:os'
import path from 'node:path'
import { buildRelayCommandEnv } from './relay-command-env'
import {
  defaultGrokHomePath,
  GROK_HOME_PATH_MAX_LENGTH,
  normalizeGrokHomePath
} from '../shared/grok-session-paths'
import { runProcess } from '../shared/child-process/run-process'

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
    const result = await runProcess({
      program: shell,
      args: [mode, `printenv GROK_HOME | head -c ${GROK_HOME_PATH_MAX_LENGTH + 1}`],
      env: buildRelayCommandEnv(process.env, process.platform),
      timeoutMs: GROK_HOME_PROBE_TIMEOUT_MS
    })
    if (result.code !== 0 || result.timedOut) {
      return fallback
    }
    return normalizeGrokHomePath(result.stdout.split(/\r?\n/, 1)[0] ?? '') ?? fallback
  } catch {
    return fallback
  }
}
