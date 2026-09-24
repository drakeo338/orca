import type { ComponentProps, ReactNode } from 'react'
import type { Button } from '../ui/button'
import type { OrcaCliSkillRuntime } from '@/lib/orca-cli-install-status'
import type { LocalAgentRuntime } from './CliSkillRuntimeSetup'

type AgentSkillSetupPanelVariant = 'card' | 'inline'

export type AgentSkillSetupPanelProps = {
  title: string
  description: ReactNode
  command: string
  installedCommand?: string
  terminalTitle: string
  terminalAriaLabel: string
  terminalWorktreeId: string
  installed: boolean
  loading: boolean
  error: string | null
  installDisabled?: boolean
  terminalHeightPx?: number
  terminalShellOverride?: string
  terminalRuntime?: LocalAgentRuntime
  leading?: ReactNode
  icon?: ReactNode
  variant?: AgentSkillSetupPanelVariant
  className?: string
  // Enclosing modals can own the title and status.
  hideHeader?: boolean
  preInstallNotice?: ReactNode
  // Where agents run `orca`, for the pre-install notice; defaults to the host.
  prerequisiteRuntime?: OrcaCliSkillRuntime
  onBeforeOpenTerminal?: () => void | Promise<void>
  showInstallWhenInstalled?: boolean
  showRecheckWhenInstalled?: boolean
  installLabel?: string
  installedInstallLabel?: string
  // Modal footers can promote Install to the primary action.
  installVariant?: ComponentProps<typeof Button>['variant']
  actionHint?: ReactNode
  openingHint?: ReactNode
  footer?: ReactNode
  onRecheck: () => void | Promise<unknown>
  // Freshness inventory is local-host-only.
  freshnessSkillName?: string
}
