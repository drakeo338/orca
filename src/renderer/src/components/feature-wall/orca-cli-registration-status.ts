import { translate } from '@/i18n/i18n'
import type {
  AgentCapabilityInstallStatusTone,
  AgentCapabilityReadiness
} from './agent-capability-setup-status'

type OrcaCliReadiness = Pick<
  AgentCapabilityReadiness,
  'orcaCliChecking' | 'orcaCliRegistered' | 'orcaCliStatus' | 'orcaCliUnverifiable'
>

export type OrcaCliRegistrationStatus = {
  label: string
  tone: AgentCapabilityInstallStatusTone
  registered: boolean
  /** Host-provided reason the CLI is not usable; too long for the badge. */
  detail: string | null
}

export function getOrcaCliRegistrationStatus(
  readiness: OrcaCliReadiness,
  installDisabledReason: string | null = null
): OrcaCliRegistrationStatus {
  if (readiness.orcaCliChecking) {
    return {
      label: translate(
        'auto.components.feature.wall.orca.cli.registration.status.503dfe3cc0',
        'Checking'
      ),
      tone: 'checking',
      registered: false,
      detail: null
    }
  }
  if (readiness.orcaCliRegistered) {
    return {
      label: translate(
        'auto.components.feature.wall.orca.cli.registration.status.d6a8b109f1',
        'Registered'
      ),
      tone: 'ready',
      registered: true,
      detail: null
    }
  }
  const status = readiness.orcaCliStatus
  // Why: no status without a repair reason means the read itself failed, which says nothing about registration.
  if (!status && !installDisabledReason) {
    return {
      label: translate(
        'auto.components.feature.wall.orca.cli.registration.status.checkFailed',
        'Could not check'
      ),
      tone: 'error',
      registered: false,
      detail: translate(
        'auto.components.settings.BrowserUsePane.180a9abf3a',
        'Failed to load CLI status.'
      )
    }
  }
  const detail = status?.detail ?? null
  if (status?.supported === false) {
    return {
      label: translate(
        'auto.components.feature.wall.agent.capability.setup.status.6d2b0a84e1',
        'Unavailable in this build'
      ),
      tone: 'error',
      registered: false,
      detail
    }
  }
  // Why: a null PATH read means the host could not inspect PATH, and the install path refuses to mutate it.
  if (status?.pathConfigured === null) {
    return {
      label: translate(
        'auto.components.feature.wall.orca.cli.registration.status.pathUnknown',
        'Could not check PATH'
      ),
      tone: 'error',
      registered: false,
      detail
    }
  }
  if (status?.pathConfigured === false) {
    return {
      label: translate(
        'auto.components.feature.wall.orca.cli.registration.status.965fb4c9cb',
        'Not on PATH'
      ),
      tone: 'pending',
      registered: false,
      detail
    }
  }
  return {
    label: translate(
      'auto.components.feature.wall.orca.cli.registration.status.aeee102e9b',
      'Not registered'
    ),
    tone: 'pending',
    registered: false,
    detail
  }
}

/** Whether the setup button should offer to register the CLI on its own. */
export function isOrcaCliRegistrationNeeded(readiness: OrcaCliReadiness): boolean {
  return (
    !readiness.orcaCliUnverifiable &&
    !readiness.orcaCliChecking &&
    !readiness.orcaCliRegistered &&
    readiness.orcaCliStatus?.supported !== false &&
    readiness.orcaCliStatus?.pathConfigured !== null
  )
}
