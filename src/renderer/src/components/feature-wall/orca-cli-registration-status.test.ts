import { describe, expect, it } from 'vitest'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import {
  getOrcaCliRegistrationStatus,
  isOrcaCliRegistrationNeeded
} from './orca-cli-registration-status'

function cliStatus(overrides: Partial<CliInstallStatus> = {}): CliInstallStatus {
  return {
    platform: 'darwin',
    commandName: 'orca',
    commandPath: '/usr/local/bin/orca',
    pathDirectory: '/usr/local/bin',
    pathConfigured: true,
    launcherPath: '/Applications/Orca.app/Contents/Resources/bin/orca',
    installMethod: 'symlink',
    supported: true,
    state: 'installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: null,
    ...overrides
  }
}

const NOT_REGISTERED = {
  orcaCliChecking: false,
  orcaCliRegistered: false,
  orcaCliStatus: cliStatus({ state: 'not_installed', detail: 'Register /usr/local/bin/orca.' }),
  orcaCliUnverifiable: false
}

describe('getOrcaCliRegistrationStatus', () => {
  it('reports the first probe as checking', () => {
    expect(
      getOrcaCliRegistrationStatus({
        ...NOT_REGISTERED,
        orcaCliChecking: true,
        orcaCliStatus: null
      })
    ).toEqual({ label: 'Checking', tone: 'checking', registered: false, detail: null })
  })

  it('reports a registered CLI as ready', () => {
    expect(
      getOrcaCliRegistrationStatus({
        ...NOT_REGISTERED,
        orcaCliRegistered: true,
        orcaCliStatus: cliStatus()
      })
    ).toEqual({ label: 'Registered', tone: 'ready', registered: true, detail: null })
  })

  it('reports an unsupported build as an error and keeps the host reason as detail', () => {
    expect(
      getOrcaCliRegistrationStatus({
        ...NOT_REGISTERED,
        orcaCliStatus: cliStatus({
          supported: false,
          state: 'unsupported',
          detail: 'CLI registration is not implemented on this platform.'
        })
      })
    ).toEqual({
      label: 'Unavailable in this build',
      tone: 'error',
      registered: false,
      detail: 'CLI registration is not implemented on this platform.'
    })
  })

  it('reports an installed command missing from PATH as pending', () => {
    expect(
      getOrcaCliRegistrationStatus({
        ...NOT_REGISTERED,
        orcaCliStatus: cliStatus({ pathConfigured: false, detail: null })
      })
    ).toEqual({ label: 'Not on PATH', tone: 'pending', registered: false, detail: null })
  })

  it('reports an unreadable PATH as an error the user cannot fix from here', () => {
    expect(
      getOrcaCliRegistrationStatus({
        ...NOT_REGISTERED,
        orcaCliStatus: cliStatus({
          platform: 'win32',
          pathConfigured: null,
          detail: 'Orca could not check your Windows user PATH.'
        })
      })
    ).toEqual({
      label: 'Could not check PATH',
      tone: 'error',
      registered: false,
      detail: 'Orca could not check your Windows user PATH.'
    })
  })

  it('reports a missing command, or a runtime that needs repair, as not registered', () => {
    expect(getOrcaCliRegistrationStatus(NOT_REGISTERED)).toEqual({
      label: 'Not registered',
      tone: 'pending',
      registered: false,
      detail: 'Register /usr/local/bin/orca.'
    })
    expect(
      getOrcaCliRegistrationStatus({ ...NOT_REGISTERED, orcaCliStatus: null }, 'Install WSL first')
    ).toEqual({
      label: 'Not registered',
      tone: 'pending',
      registered: false,
      detail: null
    })
  })

  it('reports a failed status read as a failed check, not as unregistered', () => {
    expect(getOrcaCliRegistrationStatus({ ...NOT_REGISTERED, orcaCliStatus: null })).toEqual({
      label: 'Could not check',
      tone: 'error',
      registered: false,
      detail: 'Failed to load CLI status.'
    })
  })
})

describe('isOrcaCliRegistrationNeeded', () => {
  it('offers registration only when the CLI is known to be missing and installable', () => {
    expect(isOrcaCliRegistrationNeeded(NOT_REGISTERED)).toBe(true)
    expect(isOrcaCliRegistrationNeeded({ ...NOT_REGISTERED, orcaCliStatus: null })).toBe(true)
    expect(isOrcaCliRegistrationNeeded({ ...NOT_REGISTERED, orcaCliChecking: true })).toBe(false)
    expect(isOrcaCliRegistrationNeeded({ ...NOT_REGISTERED, orcaCliRegistered: true })).toBe(false)
    expect(isOrcaCliRegistrationNeeded({ ...NOT_REGISTERED, orcaCliUnverifiable: true })).toBe(
      false
    )
    expect(
      isOrcaCliRegistrationNeeded({
        ...NOT_REGISTERED,
        orcaCliStatus: cliStatus({ supported: false, state: 'unsupported' })
      })
    ).toBe(false)
    // Why: the install path refuses to run when the PATH read is unknown.
    expect(
      isOrcaCliRegistrationNeeded({
        ...NOT_REGISTERED,
        orcaCliStatus: cliStatus({ platform: 'win32', pathConfigured: null })
      })
    ).toBe(false)
  })
})
