import type { AgentSessionLaunchArgs, AgentSessionLaunchEnv } from './agent-session-record'

// Validators for the launch inputs a host captures when it creates a session.

const MAX_LAUNCH_ENV_KEY_LENGTH = 512
const MAX_LAUNCH_ENV_ENTRIES = 256
const MAX_LAUNCH_ENV_VALUE_LENGTH = 65_536
const MAX_LAUNCH_ARGS = 256
const MAX_LAUNCH_ARGS_BYTES = 16 * 1024

export function isAgentSessionLaunchEnv(value: unknown): value is AgentSessionLaunchEnv {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const entries = Object.entries(value)
  return (
    entries.length <= MAX_LAUNCH_ENV_ENTRIES &&
    entries.every(
      ([key, entry]) =>
        key.length > 0 &&
        key.length <= MAX_LAUNCH_ENV_KEY_LENGTH &&
        typeof entry === 'string' &&
        entry.length <= MAX_LAUNCH_ENV_VALUE_LENGTH
    )
  )
}

export function isAgentSessionLaunchArgs(value: unknown): value is AgentSessionLaunchArgs {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LAUNCH_ARGS &&
    value.every((arg) => typeof arg === 'string' && !arg.includes('\0')) &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_LAUNCH_ARGS_BYTES
  )
}
