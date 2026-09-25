import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const rendererRoot = path.join(repoRoot, 'src/renderer')

// Why: every surface that only displays "is the CLI registered?" must share
// useOrcaCliInstallStatus, or two surfaces drift apart and each adds its own reads.
const CLI_STATUS_READ =
  /\b(getInstallStatus|getWslInstallStatus|readOrcaCliInstallStatus|readAgentRuntimeCliInstallStatus)\b/

const sanctionedReaders = new Map<string, string>([
  ['src/renderer/src/lib/orca-cli-install-status.ts', 'the runtime-aware read primitive'],
  ['src/renderer/src/hooks/use-orca-cli-install-status.ts', 'the shared status store'],
  [
    'src/renderer/src/components/settings/CliSection.tsx',
    'host registration toggle: shows install-result detail for this machine whatever runtime is active'
  ],
  [
    'src/renderer/src/components/settings/WslCliRegistration.tsx',
    'WSL default-distro registration toggle, which has no project runtime to key the store on'
  ],
  [
    'src/renderer/src/lib/agent-skill-cli-prerequisite.ts',
    'reads the host CLI to decide whether to register it'
  ],
  [
    'src/renderer/src/components/settings/CliSkillRuntimeSetup.tsx',
    'reads the WSL CLI to decide whether to register it'
  ],
  [
    'src/renderer/src/components/onboarding/onboarding-feature-setup.ts',
    'onboarding Enable CLI action reads to decide whether to register'
  ],
  [
    'src/renderer/src/components/floating-terminal/use-floating-terminal-orchestration-visibility.ts',
    'banner visibility read when the floating terminal opens and on CLI broadcasts'
  ],
  [
    'src/renderer/src/app-shell/use-onboarding-and-feature-tips.ts',
    'one-shot startup read that gates feature tips'
  ],
  [
    'src/renderer/src/components/sidebar/LinearAgentSkillSetupPrompt.tsx',
    'identity-guarded setup check that reads the host CLI even for remote worktrees'
  ],
  [
    'src/renderer/src/components/emulator-pane/use-mobile-emulator-agent-setup-state.ts',
    'local-host emulator guide whose re-check awaits the read it reports on'
  ],
  ['src/renderer/src/web/preload-api/web-cli-api.ts', 'implements the API for paired web clients'],
  [
    'src/renderer/src/components/floating-terminal/floating-terminal-panel-test-harness.ts',
    'test harness mock'
  ]
])

function relativeRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

function findRendererSourcesMatching(pattern: RegExp, dir = rendererRoot): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry)
    if (statSync(entryPath).isDirectory()) {
      found.push(...findRendererSourcesMatching(pattern, entryPath))
      continue
    }
    if (!/\.tsx?$/.test(entryPath) || /\.test\.tsx?$/.test(entryPath)) {
      continue
    }
    if (pattern.test(readFileSync(entryPath, 'utf8'))) {
      found.push(relativeRepoPath(entryPath))
    }
  }
  return found.sort()
}

function findCliStatusReaders(): string[] {
  return findRendererSourcesMatching(CLI_STATUS_READ)
}

// Why: a status reader stays stale until the next focus unless every CLI change tells it to re-read.
const CLI_INSTALL_MUTATION =
  /\bcli\??\s*\.\s*(install|installWsl|remove|removeWsl)\s*\(|\binstallAgentRuntimeCli\s*\(/
// Why: this primitive stays quiet so a caller announces once per check; its callers are listed below.
const QUIET_INSTALL_PRIMITIVE = 'src/renderer/src/lib/orca-cli-install-status.ts'

const sanctionedMutators = new Map<string, string>([
  [QUIET_INSTALL_PRIMITIVE, 'runtime-aware install primitive; its callers announce'],
  [
    'src/renderer/src/lib/agent-skill-cli-prerequisite.ts',
    'registers the host CLI before agent skill setup'
  ],
  [
    'src/renderer/src/components/settings/CliSkillRuntimeSetup.tsx',
    'registers the WSL CLI before agent skill setup'
  ],
  [
    'src/renderer/src/components/onboarding/onboarding-feature-setup.ts',
    'onboarding Install CLI & Skills registers the CLI for the chosen runtime'
  ],
  ['src/renderer/src/components/feature-tips/FeatureTipsModal.tsx', 'Orca CLI feature tip setup'],
  [
    'src/renderer/src/components/settings/use-cli-registration-actions.ts',
    'Settings host registration toggle'
  ],
  [
    'src/renderer/src/components/settings/WslCliRegistration.tsx',
    'Settings WSL registration toggle'
  ]
])

describe('Orca CLI install status readers', () => {
  it('reads the CLI status only through the shared store outside sanctioned readers', () => {
    const readers = findCliStatusReaders()

    expect(readers.filter((reader) => !sanctionedReaders.has(reader))).toEqual([])
  })

  it('keeps the sanctioned list free of modules that no longer read', () => {
    const readers = new Set(findCliStatusReaders())

    expect([...sanctionedReaders.keys()].filter((reader) => !readers.has(reader))).toEqual([])
  })
})

describe('Orca CLI install mutators', () => {
  it('changes CLI registration only in sanctioned modules that tell status readers to re-read', () => {
    const mutators = findRendererSourcesMatching(CLI_INSTALL_MUTATION)

    expect(mutators.filter((mutator) => !sanctionedMutators.has(mutator))).toEqual([])
    expect(
      mutators.filter(
        (mutator) =>
          mutator !== QUIET_INSTALL_PRIMITIVE &&
          !readFileSync(path.join(repoRoot, mutator), 'utf8').includes(
            'notifyOrcaCliInstallStateChanged'
          )
      )
    ).toEqual([])
  })

  it('keeps the sanctioned list free of modules that no longer change registration', () => {
    const mutators = new Set(findRendererSourcesMatching(CLI_INSTALL_MUTATION))

    expect([...sanctionedMutators.keys()].filter((mutator) => !mutators.has(mutator))).toEqual([])
  })
})
