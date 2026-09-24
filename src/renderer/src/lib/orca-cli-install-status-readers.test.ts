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
    'one-shot read when the floating terminal opens'
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

function findCliStatusReaders(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry)
    if (statSync(entryPath).isDirectory()) {
      found.push(...findCliStatusReaders(entryPath))
      continue
    }
    if (!/\.tsx?$/.test(entryPath) || /\.test\.tsx?$/.test(entryPath)) {
      continue
    }
    if (CLI_STATUS_READ.test(readFileSync(entryPath, 'utf8'))) {
      found.push(relativeRepoPath(entryPath))
    }
  }
  return found.sort()
}

describe('Orca CLI install status readers', () => {
  it('reads the CLI status only through the shared store outside sanctioned readers', () => {
    const readers = findCliStatusReaders(rendererRoot)

    expect(readers.filter((reader) => !sanctionedReaders.has(reader))).toEqual([])
  })

  it('keeps the sanctioned list free of modules that no longer read', () => {
    const readers = new Set(findCliStatusReaders(rendererRoot))

    expect([...sanctionedReaders.keys()].filter((reader) => !readers.has(reader))).toEqual([])
  })
})
