import { mkdtemp, readdir, rm } from 'node:fs/promises'
import type * as NodeFsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireSkillInstallLock, skillInstallLockPath } from './skill-install-lock'

const releaseRename = vi.hoisted(() => ({ failures: 0, attempts: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      if (target.endsWith('.released')) {
        releaseRename.attempts += 1
        if (releaseRename.failures > 0) {
          releaseRename.failures -= 1
          // Windows refuses to rename a directory while a contender has a file inside it open.
          throw Object.assign(new Error(`EPERM: operation not permitted, rename '${source}'`), {
            code: 'EPERM'
          })
        }
      }
      await actual.rename(source, target)
    }
  }
})

const roots: string[] = []

afterEach(async () => {
  releaseRename.failures = 0
  releaseRename.attempts = 0
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('skill install lock release when the lock directory cannot be renamed', () => {
  it('reports the release and leaves the marked lock for the next acquirer to reclaim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-lock-release-rename-'))
    roots.push(root)
    const lockPath = skillInstallLockPath(join(root, 'state'), join(root, 'skills', 'alpha'))
    const release = await acquireSkillInstallLock({ path: lockPath })
    releaseRename.failures = 1

    await expect(release()).resolves.toBeUndefined()
    // No retry: once marked, the canonical path may already belong to a newer holder.
    expect(releaseRename.attempts).toBe(1)
    expect((await readdir(lockPath)).some((name) => name.endsWith('.released'))).toBe(true)

    const next = await acquireSkillInstallLock({ path: lockPath, timeoutMs: 500 })
    await next()
    await expect(readdir(dirname(lockPath))).resolves.toEqual([])
  })
})
