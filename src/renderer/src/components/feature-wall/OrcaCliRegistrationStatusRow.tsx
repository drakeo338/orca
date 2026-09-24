import { Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import type {
  AgentCapabilityInstallStatusTone,
  AgentCapabilityReadiness
} from './agent-capability-setup-status'
import { getOrcaCliRegistrationStatus } from './orca-cli-registration-status'

function getOrcaCliBadgeVariant(
  tone: AgentCapabilityInstallStatusTone
): 'secondary' | 'destructive' | 'outline' {
  if (tone === 'ready') {
    return 'secondary'
  }
  return tone === 'error' ? 'destructive' : 'outline'
}

export function OrcaCliRegistrationStatusRow(props: {
  readiness: AgentCapabilityReadiness
  installDisabledReason: string | null
}): React.JSX.Element {
  const { readiness } = props
  // Why: the step counts as done here, so say why instead of showing nothing.
  const registration = readiness.orcaCliUnverifiable
    ? null
    : getOrcaCliRegistrationStatus(readiness, props.installDisabledReason)
  const commandPath = readiness.orcaCliStatus?.commandPath
  const detail = props.installDisabledReason ?? registration?.detail

  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">
          <Terminal className="size-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {translate(
                'auto.components.feature.wall.OrcaCliRegistrationStatusRow.af16f704ca',
                'Orca CLI'
              )}
            </span>
            {registration ? (
              <Badge variant={getOrcaCliBadgeVariant(registration.tone)}>
                {registration.label}
              </Badge>
            ) : null}
          </div>
          {!registration ? (
            <p className="text-xs leading-snug text-muted-foreground">
              {translate(
                'auto.components.settings.BrowserUsePane.remoteManaged',
                'CLI registration is managed on the Orca server that runs your agents.'
              )}
            </p>
          ) : registration.registered && commandPath ? (
            <p className="text-xs leading-snug text-muted-foreground">
              {translate(
                'auto.components.feature.wall.OrcaCliRegistrationStatusRow.fd07e4468c',
                'Installed at'
              )}{' '}
              <code className="font-mono">{commandPath}</code>
            </p>
          ) : (
            <>
              <p className="text-xs leading-snug text-muted-foreground">
                {translate(
                  'auto.components.feature.wall.OrcaCliRegistrationStatusRow.06b6808275',
                  'Agents need the orca command on PATH to use the browser, orchestration, and computer skills.'
                )}
              </p>
              {!registration.registered && detail ? (
                <p className="break-words text-xs leading-snug text-muted-foreground">{detail}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
