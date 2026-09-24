import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))

import {
  createNotebookVenv,
  findWorkspaceInterpreters,
  installIpykernel
} from './python-environments'

function existing(...paths: string[]): (path: string) => boolean {
  return (path) => paths.includes(path)
}

describe('findWorkspaceInterpreters', () => {
  it('walks from the notebook folder to the workspace root, nearest env first', () => {
    const exists = existing(
      join('/repo/.venv/bin/python'),
      join('/repo/analysis/.conda/bin/python'),
      join('/.venv/bin/python')
    )
    expect(
      findWorkspaceInterpreters('/repo/analysis/week1/nb.ipynb', '/repo', 'darwin', exists)
    ).toEqual([join('/repo/analysis/.conda/bin/python'), join('/repo/.venv/bin/python')])
  })

  it('only looks beside the notebook when it is outside the workspace or there is none', () => {
    const exists = existing(join('/elsewhere/.venv/bin/python'), join('/.venv/bin/python'))
    expect(findWorkspaceInterpreters('/elsewhere/nb.ipynb', '/repo', 'linux', exists)).toEqual([
      join('/elsewhere/.venv/bin/python')
    ])
    expect(findWorkspaceInterpreters('/elsewhere/nb.ipynb', null, 'linux', exists)).toEqual([
      join('/elsewhere/.venv/bin/python')
    ])
  })

  it('uses Scripts\\\\python.exe for venvs and the env root for conda on Windows', () => {
    const exists = existing(join('/repo/.venv/Scripts/python.exe'), join('/repo/.conda/python.exe'))
    expect(findWorkspaceInterpreters('/repo/nb.ipynb', '/repo', 'win32', exists)).toEqual([
      join('/repo/.venv/Scripts/python.exe'),
      join('/repo/.conda/python.exe')
    ])
  })
})

describe('installIpykernel', () => {
  it('bootstraps pip with ensurepip when the env has none, then installs', async () => {
    const result = (code: number, stderr = '') => ({ code, stderr, stdout: '' })
    runProcessMock
      .mockResolvedValueOnce(result(1, '/venv/bin/python: No module named pip'))
      .mockResolvedValueOnce(result(0))
      .mockResolvedValueOnce(result(0))
    await expect(installIpykernel('/venv/bin/python')).resolves.toEqual({ ok: true, detail: '' })
    expect(runProcessMock.mock.calls.map(([spec]) => spec.args)).toEqual([
      ['-m', 'pip', 'install', '-U', 'ipykernel'],
      ['-m', 'ensurepip'],
      ['-m', 'pip', 'install', '-U', 'ipykernel']
    ])
  })
})

describe('createNotebookVenv', () => {
  beforeEach(() => runProcessMock.mockReset())

  it('creates .venv in the parent, installs ipykernel into it, and describes it', async () => {
    const venv = join('/repo', '.venv')
    const venvPython =
      process.platform === 'win32' ? `${venv}\\Scripts\\python.exe` : `${venv}/bin/python`
    runProcessMock
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: `${venvPython}\n3.14.0\n`, stderr: '' })
    const result = await createNotebookVenv('/usr/bin/python3', '/repo')
    expect(result).toMatchObject({ ok: true, environment: { path: venvPython, version: '3.14.0' } })
    expect(
      runProcessMock.mock.calls.map(([spec]) => [spec.program, ...spec.args.slice(0, 3)])
    ).toEqual([
      ['/usr/bin/python3', '-m', 'venv', venv],
      [venvPython, '-m', 'pip', 'install'],
      [venvPython, '-c', expect.any(String)]
    ])
  })

  it('reports why venv creation failed', async () => {
    runProcessMock.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr:
        'The virtual environment was not created successfully because ensurepip is not available.'
    })
    await expect(createNotebookVenv('/usr/bin/python3', '/repo')).resolves.toEqual({
      ok: false,
      detail: expect.stringContaining('ensurepip is not available')
    })
  })
})
