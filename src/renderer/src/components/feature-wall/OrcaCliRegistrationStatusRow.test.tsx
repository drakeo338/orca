import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentCapabilityReadiness } from './agent-capability-setup-status'
import { OrcaCliRegistrationStatusRow } from './OrcaCliRegistrationStatusRow'

const READINESS: AgentCapabilityReadiness = {
  browserUseSkillInstalled: false,
  browserUseSkillLoading: false,
  computerUseSkillInstalled: false,
  computerUseSkillLoading: false,
  computerUseReady: false,
  computerUseChecking: false,
  computerUseUnavailable: false,
  orchestrationSkillInstalled: false,
  orchestrationSkillLoading: false,
  orcaCliRegistered: false,
  orcaCliChecking: false,
  orcaCliStatus: null,
  orcaCliUnverifiable: false
}

describe('OrcaCliRegistrationStatusRow', () => {
  it('explains a remote runtime instead of leaving its done step unexplained', () => {
    const html = renderToStaticMarkup(
      <OrcaCliRegistrationStatusRow
        readiness={{ ...READINESS, orcaCliUnverifiable: true }}
        installDisabledReason={null}
      />
    )

    expect(html).toContain('CLI registration is managed on the Orca server that runs your agents.')
    expect(html).not.toContain('Could not check')
  })

  it('says the status read failed rather than that the CLI is not registered', () => {
    const html = renderToStaticMarkup(
      <OrcaCliRegistrationStatusRow readiness={READINESS} installDisabledReason={null} />
    )

    expect(html).toContain('Could not check')
    expect(html).toContain('Failed to load CLI status.')
    expect(html).not.toContain('Not registered')
  })
})
