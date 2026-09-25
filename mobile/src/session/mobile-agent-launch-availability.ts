import { supportsMobileExistingAgentLaunch } from './mobile-existing-agent-launch'

/**
 * Whether an AI button that starts an agent with a prompt can be used on this host. There is no
 * older-host fallback: the path before `agent.launch` typed the prompt into a bare shell.
 */
export type MobileAgentLaunchAvailability = 'checking' | 'available' | 'update-required'

export function resolveMobileAgentLaunchAvailability(
  hostCapabilities: readonly string[],
  hostStatusPending: boolean
): MobileAgentLaunchAvailability {
  if (supportsMobileExistingAgentLaunch(hostCapabilities)) {
    return 'available'
  }
  return hostStatusPending ? 'checking' : 'update-required'
}
