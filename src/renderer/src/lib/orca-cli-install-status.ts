import type { CliInstallStatus } from '../../../shared/cli-install-types'
import type { ProjectAgentSkillRuntime } from './project-skill-runtime'
import {
  ensureWslCliAvailableForAgentSkillTerminal,
  getWslCliDistroRequest
} from '@/components/settings/CliSkillRuntimeSetup'
import { ensureOrcaCliAvailableForAgentSkillTerminal } from './agent-skill-cli-prerequisite'
import { notifyOrcaCliInstallStateChanged } from './orca-cli-install-state-event'

export type OrcaCliSkillRuntime = {
  agentRuntime?: ProjectAgentSkillRuntime
  installDisabledReason: string | null
}

/** Reads `orca` where this runtime's agents run it: the WSL distro for a WSL runtime, else the host. */
export function readAgentRuntimeCliInstallStatus(
  agentRuntime?: ProjectAgentSkillRuntime
): Promise<CliInstallStatus> {
  return agentRuntime?.runtime === 'wsl'
    ? window.api.cli.getWslInstallStatus(getWslCliDistroRequest(agentRuntime))
    : window.api.cli.getInstallStatus()
}

/** Registers `orca` where this runtime's agents run it, then tells every status reader to re-read. */
export async function installAgentRuntimeCli(
  agentRuntime?: ProjectAgentSkillRuntime
): Promise<CliInstallStatus> {
  const next = await (agentRuntime?.runtime === 'wsl'
    ? window.api.cli.installWsl(getWslCliDistroRequest(agentRuntime))
    : window.api.cli.install())
  notifyOrcaCliInstallStateChanged()
  return next
}

/** Registers `orca` where this runtime's agents run it if it is missing, then has every reader re-read. */
export async function ensureAgentRuntimeCliRegistered(
  agentRuntime?: ProjectAgentSkillRuntime
): Promise<void> {
  try {
    await (agentRuntime?.runtime === 'wsl'
      ? ensureWslCliAvailableForAgentSkillTerminal(agentRuntime)
      : ensureOrcaCliAvailableForAgentSkillTerminal())
  } finally {
    // Why: when the CLI turns out to be registered already nothing is installed or broadcast, so a stale row would stay.
    notifyOrcaCliInstallStateChanged()
  }
}

/** Identifies what `readOrcaCliInstallStatus` reads, so callers can drop results for a retired target. */
export function getOrcaCliInstallTargetKey(runtime: OrcaCliSkillRuntime): string {
  if (runtime.installDisabledReason) {
    return 'install-disabled'
  }
  if (runtime.agentRuntime?.runtime !== 'wsl') {
    return 'host'
  }
  return `wsl:${getWslCliDistroRequest(runtime.agentRuntime)?.distro ?? ''}`
}

/** Runtime-aware read; null when the runtime needs repair and so has no install target. */
export async function readOrcaCliInstallStatus(
  runtime: OrcaCliSkillRuntime
): Promise<CliInstallStatus | null> {
  if (runtime.installDisabledReason || !window.api?.cli) {
    return null
  }
  return readAgentRuntimeCliInstallStatus(runtime.agentRuntime)
}
