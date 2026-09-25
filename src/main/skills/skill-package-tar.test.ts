import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  openSkillTarGzip,
  parseSkillTarHeader,
  SKILL_TAR_BLOCK_BYTES,
  writeSkillTarGzip
} from './skill-package-tar'

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii')
}

function refreshChecksum(header: Buffer): void {
  header.fill(0x20, 148, 156)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
}

function header(type = '0'): Buffer {
  const value = Buffer.alloc(SKILL_TAR_BLOCK_BYTES)
  value.write('skill/SKILL.md', 0, 'utf8')
  writeOctal(value, 100, 8, 0o644)
  writeOctal(value, 108, 8, 0)
  writeOctal(value, 116, 8, 0)
  writeOctal(value, 124, 12, 0)
  writeOctal(value, 136, 12, 0)
  value[156] = type.charCodeAt(0)
  value.write('ustar\0', 257, 'ascii')
  value.write('00', 263, 'ascii')
  refreshChecksum(value)
  return value
}

describe('skill package tar envelope', () => {
  it.each(['1', '2', '3', '4', '5', '6', '7', 'x', 'g', 'L', 'K', 's'])(
    'rejects non-regular tar entry type %s',
    (type) => {
      expect(() => parseSkillTarHeader(header(type))).toThrow('skill-package-tar-entry-type')
    }
  )

  it('requires the deterministic ustar dialect', () => {
    const legacy = header()
    legacy.fill(0, 257, 265)
    refreshChecksum(legacy)
    expect(() => parseSkillTarHeader(legacy)).toThrow('skill-package-tar-format-invalid')
  })

  it('fuzzes fixed-size headers without unbounded parsing or non-Error failures', () => {
    let state = 0x51a7e
    const randomByte = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state & 0xff
    }
    for (let sample = 0; sample < 5_000; sample += 1) {
      const value = Buffer.allocUnsafe(SKILL_TAR_BLOCK_BYTES)
      for (let index = 0; index < value.length; index += 1) {
        value[index] = randomByte()
      }
      refreshChecksum(value)
      try {
        const parsed = parseSkillTarHeader(value)
        expect(parsed === null || Buffer.byteLength(parsed.path, 'utf8') <= 256).toBe(true)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    }
  })

  it('aborts an archive whose read pipeline already finished without an uncaught error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-tar-abort-'))
    const uncaught: unknown[] = []
    const record = (error: unknown): void => {
      uncaught.push(error)
    }
    process.on('uncaughtException', record)
    try {
      const archivePath = join(root, 'small.tar.gz')
      const bytes = Buffer.from('# Small\n')
      await writeSkillTarGzip(archivePath, [
        { path: 'SKILL.md', size: bytes.length, executable: false, bytes }
      ])
      const archive = await openSkillTarGzip(archivePath)
      // A small archive is fully read and inflated before a slow caller fails, e.g. a Windows mkdir.
      await archive.archiveIdentity

      archive.abort(new Error('caller-failed-after-read'))
      await new Promise<void>((resolve) => setTimeout(resolve, 20))

      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', record)
      await rm(root, { recursive: true, force: true })
    }
  })
})
