// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCA_CLI_INSTALL_STATE_EVENT } from './orca-cli-install-state-event'
import { ensureAgentRuntimeCliRegistered } from './orca-cli-install-status'

const ensureHost = vi.hoisted(() => vi.fn(async () => null))
const ensureWsl = vi.hoisted(() => vi.fn(async () => null))

vi.mock('./agent-skill-cli-prerequisite', () => ({
  ensureOrcaCliAvailableForAgentSkillTerminal: ensureHost
}))
vi.mock('@/components/settings/CliSkillRuntimeSetup', () => ({
  ensureWslCliAvailableForAgentSkillTerminal: ensureWsl,
  getWslCliDistroRequest: () => undefined
}))

afterEach(() => {
  ensureHost.mockClear()
  ensureWsl.mockClear()
})

describe('ensureAgentRuntimeCliRegistered', () => {
  it('has readers re-read even when the CLI was already registered and nothing was installed', async () => {
    const listener = vi.fn()
    window.addEventListener(ORCA_CLI_INSTALL_STATE_EVENT, listener)
    try {
      await ensureAgentRuntimeCliRegistered()
      await ensureAgentRuntimeCliRegistered({ runtime: 'wsl', wslDistro: 'Ubuntu', label: 'WSL' })
    } finally {
      window.removeEventListener(ORCA_CLI_INSTALL_STATE_EVENT, listener)
    }

    expect(ensureHost).toHaveBeenCalledTimes(1)
    expect(ensureWsl).toHaveBeenCalledWith({ runtime: 'wsl', wslDistro: 'Ubuntu', label: 'WSL' })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
