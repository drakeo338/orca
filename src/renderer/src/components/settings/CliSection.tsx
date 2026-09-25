import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  ORCA_CLI_SKILL_INSTALL_COMMAND,
  ORCA_CLI_SKILL_NAME,
  ORCA_CLI_SKILL_UPDATE_COMMAND
} from '@/lib/agent-feature-install-commands'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { ORCA_CLI_INSTALL_STATE_EVENT } from '@/lib/orca-cli-install-state-event'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import { CliRegistrationDialog } from './CliRegistrationDialog'
import {
  buildSkillCommandForRuntime,
  ensureWslCliAvailableForAgentSkillTerminal,
  getAgentSkillTerminalShellOverride,
  getSelectedAgentRuntime,
  getSkillDiscoveryTargetForRuntime
} from './CliSkillRuntimeSetup'
import { WslCliRegistration } from './WslCliRegistration'
import { useCliRegistrationActions } from './use-cli-registration-actions'
import { useLocalCliSkillFreshnessName } from './use-local-cli-skill-freshness-name'
import { translate } from '@/i18n/i18n'

type CliSectionProps = {
  currentPlatform: string
  settings: GlobalSettings
  wslSupportedPlatform?: boolean
  wslAvailable?: boolean
  wslCapabilitiesLoading?: boolean
}

function getRevealLabel(platform: string): string {
  if (platform === 'darwin') {
    return translate('auto.components.settings.CliSection.6f894ef9c2', 'Show in Finder')
  }
  if (platform === 'win32') {
    return translate('auto.components.settings.CliSection.cbe55e4d48', 'Show in Explorer')
  }
  return translate('auto.components.settings.CliSection.9fd4023db0', 'Show in File Manager')
}

function getInstallDescription(platform: string): string {
  if (platform === 'darwin') {
    return 'Register `orca` in /usr/local/bin.'
  }
  if (platform === 'linux') {
    return 'Register `orca-ide` in ~/.local/bin.'
  }
  if (platform === 'win32') {
    return 'Register `orca` in your user PATH.'
  }
  return 'CLI registration is not yet available on this platform.'
}

function getFallbackCommandName(platform: string): string {
  return platform === 'linux' ? 'orca-ide' : 'orca'
}

export function CliSection({
  currentPlatform,
  settings,
  wslSupportedPlatform = false,
  wslAvailable = false,
  wslCapabilitiesLoading = false
}: CliSectionProps): React.JSX.Element {
  const [status, setStatus] = useState<CliInstallStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const mountedRef = useMountedRef()
  const statusReadGenerationRef = useRef(0)
  const agentRuntime = useMemo(
    () =>
      getSelectedAgentRuntime(settings, wslSupportedPlatform, wslAvailable, wslCapabilitiesLoading),
    [settings, wslAvailable, wslCapabilitiesLoading, wslSupportedPlatform]
  )
  const cliSkillFreshnessName = useLocalCliSkillFreshnessName(agentRuntime)
  const cliSkillDiscoveryTarget = useMemo(
    () => getSkillDiscoveryTargetForRuntime(agentRuntime),
    [agentRuntime]
  )
  const {
    installed: cliSkillDetected,
    loading: cliSkillLoading,
    error: cliSkillError,
    refresh: refreshCliSkill
  } = useInstalledAgentSkill(ORCA_CLI_SKILL_NAME, {
    discoveryTarget: cliSkillDiscoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const cliSkillInstallCommand = buildSkillCommandForRuntime(
    ORCA_CLI_SKILL_INSTALL_COMMAND,
    agentRuntime
  )
  const cliSkillUpdateCommand = buildSkillCommandForRuntime(
    ORCA_CLI_SKILL_UPDATE_COMMAND,
    agentRuntime
  )
  const cliSkillTerminalShellOverride = getAgentSkillTerminalShellOverride(
    currentPlatform,
    settings,
    agentRuntime
  )
  const cliSkillPrerequisiteRuntime = useMemo(
    () => ({ agentRuntime, installDisabledReason: null }),
    [agentRuntime]
  )

  const handleStatusChange = useCallback(
    (nextStatus: CliInstallStatus): void => {
      if (mountedRef.current) {
        setStatus(nextStatus)
      }
    },
    [mountedRef]
  )

  const closeDialog = useCallback((): void => setDialogOpen(false), [])
  const commandName = status?.commandName ?? getFallbackCommandName(currentPlatform)
  const { busyAction, installFailure, clearInstallFailure, install, remove } =
    useCliRegistrationActions({
      commandName,
      mountedRef,
      onStatusChange: handleStatusChange,
      onSettled: closeDialog
    })

  const loadStatus = useCallback(
    async ({ keepShownStatus = false }: { keepShownStatus?: boolean } = {}): Promise<void> => {
      const generation = ++statusReadGenerationRef.current
      const isCurrent = (): boolean =>
        mountedRef.current && generation === statusReadGenerationRef.current
      // Why: a broadcast re-read must not flash "Checking…" or disable the toggle just flipped.
      if (!keepShownStatus) {
        setLoading(true)
      }
      try {
        const nextStatus = await window.api.cli.getInstallStatus()
        if (isCurrent()) {
          setStatus(nextStatus)
        }
      } catch (error) {
        if (isCurrent()) {
          toast.error(
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.settings.CliSection.7baec27029',
                  'Failed to load CLI status.'
                )
          )
        }
      } finally {
        if (isCurrent()) {
          setLoading(false)
        }
      }
    },
    [mountedRef]
  )

  const refreshStatus = useCallback(async (): Promise<void> => {
    clearInstallFailure()
    await loadStatus()
  }, [clearInstallFailure, loadStatus])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    // Why: registering from another surface must flip this toggle without a manual refresh.
    const handleCliStateChange = (): void => {
      void loadStatus({ keepShownStatus: true })
    }
    window.addEventListener(ORCA_CLI_INSTALL_STATE_EVENT, handleCliStateChange)
    return () => window.removeEventListener(ORCA_CLI_INSTALL_STATE_EVENT, handleCliStateChange)
  }, [loadStatus])

  const pathStatusUnknown = currentPlatform === 'win32' && status?.pathConfigured === null
  const isEnabled = status?.state === 'installed' && !pathStatusUnknown
  const isSupported = status?.supported ?? false
  const isBrowserManaged = status?.unsupportedReason === 'launch_mode_unavailable'
  const revealLabel = getRevealLabel(currentPlatform)
  const canRevealCommandPath =
    status?.commandPath != null && ['installed', 'stale', 'conflict'].includes(status.state)

  return (
    <section className="space-y-4" data-settings-section="cli">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {translate('auto.components.settings.CliSection.c5c0f2641d', 'Orca CLI')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.CliSection.6930feda9e',
            'Use Orca from your terminal to open the app, manage worktrees, and interact with Orca terminals.'
          )}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>
              {translate('auto.components.settings.CliSection.38edbb5721', 'Shell command')}
            </Label>
            <p
              className={`text-xs ${pathStatusUnknown ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
            >
              {loading
                ? translate(
                    'auto.components.settings.CliSection.d363e5929b',
                    'Checking CLI registration…'
                  )
                : (status?.detail ?? getInstallDescription(currentPlatform))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void refreshStatus()}
                    disabled={loading || busyAction !== null}
                    aria-label={translate(
                      'auto.components.settings.CliSection.52e640f3a0',
                      'Refresh CLI status'
                    )}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate('auto.components.settings.CliSection.5dae812f50', 'Refresh')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {!isBrowserManaged ? (
              <Switch
                aria-label={translate(
                  'auto.components.settings.CliSection.38edbb5721',
                  'Shell command'
                )}
                checked={isEnabled}
                disabled={loading || !isSupported || pathStatusUnknown || busyAction !== null}
                onCheckedChange={() => setDialogOpen(true)}
                className="disabled:opacity-60"
              />
            ) : null}
          </div>
        </div>

        {status?.commandPath ? (
          <p className="text-xs text-muted-foreground">
            {translate('auto.components.settings.CliSection.15eaad0d31', 'Command path:')}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{status.commandPath}</code>
          </p>
        ) : null}

        {status?.state === 'stale' && status.currentTarget ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {translate(
              'auto.components.settings.CliSection.b0c310ab46',
              'Existing launcher target:'
            )}{' '}
            <code>{status.currentTarget}</code>
          </p>
        ) : null}

        {status?.state === 'installed' &&
        status.pathConfigured === false &&
        status.pathDirectory ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {status.pathDirectory}{' '}
            {translate(
              'auto.components.settings.CliSection.7f2747f7dd',
              'is not currently visible on PATH for this shell.'
            )}
          </p>
        ) : null}

        {!loading && !isSupported && !isBrowserManaged && status?.detail ? (
          <p className="text-xs text-muted-foreground">{status.detail}</p>
        ) : null}

        {installFailure ? (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <p className="font-medium">
              {translate(
                'auto.components.settings.CliSection.a2b13efa94',
                'Failed to register `{{value0}}` in PATH.',
                { value0: commandName }
              )}
            </p>
            <p className="leading-snug">{installFailure.reason}</p>
            {installFailure.conflictCommandPath ? (
              <p className="leading-snug">
                {translate(
                  'auto.components.settings.CliSection.installFailureConflictRemedy',
                  'Remove {{value0}} and register again if it is no longer needed.',
                  { value0: installFailure.conflictCommandPath }
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {status?.commandPath ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.api.shell.openPath(status.commandPath as string)}
              disabled={loading || !canRevealCommandPath}
              className="gap-2"
            >
              <FolderOpen className="size-3.5" />
              {revealLabel}
            </Button>
          ) : null}
        </div>

        {!isBrowserManaged ? (
          <div className="border-t border-border/60 pt-3">
            <div className="space-y-0.5">
              <Label>
                {translate('auto.components.settings.CliSection.04873eea3e', 'Agent skills')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CliSection.36a6f919ba',
                  'Give agents Orca-aware workspace, terminal, and progress workflows.'
                )}
              </p>
            </div>

            <AgentSkillSetupPanel
              className="mt-3"
              variant="inline"
              title={translate('auto.components.settings.CliSection.6053cf736c', 'CLI skill')}
              description={translate(
                'auto.components.settings.CliSection.e8012c03a1',
                'Enables agents to use Orca workspace, terminal, and progress commands.'
              )}
              command={cliSkillInstallCommand}
              installedCommand={cliSkillUpdateCommand}
              terminalTitle="CLI skill setup"
              terminalAriaLabel="CLI skill install terminal"
              terminalWorktreeId={`settings-cli-skill-terminal-${agentRuntime.runtime}`}
              terminalShellOverride={cliSkillTerminalShellOverride}
              terminalRuntime={agentRuntime}
              installed={cliSkillDetected}
              loading={cliSkillLoading}
              error={cliSkillError}
              preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
              prerequisiteRuntime={cliSkillPrerequisiteRuntime}
              onBeforeOpenTerminal={async () => {
                await (agentRuntime.runtime === 'wsl'
                  ? ensureWslCliAvailableForAgentSkillTerminal(agentRuntime)
                  : ensureOrcaCliAvailableForAgentSkillTerminal({
                      onStatusChange: handleStatusChange
                    }))
              }}
              onRecheck={refreshCliSkill}
              freshnessSkillName={cliSkillFreshnessName}
            />
          </div>
        ) : null}
      </div>

      <WslCliRegistration currentPlatform={currentPlatform} />

      <CliRegistrationDialog
        busyAction={busyAction}
        commandName={commandName}
        commandPath={status?.commandPath}
        isEnabled={isEnabled}
        isSupported={isSupported}
        onInstall={install}
        onOpenChange={setDialogOpen}
        onRemove={remove}
        open={dialogOpen}
      />
    </section>
  )
}
