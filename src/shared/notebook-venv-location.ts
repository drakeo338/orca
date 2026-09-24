import { isPathInsideOrEqual } from './cross-platform-path'

/** Where a notebook's new `.venv` goes: the workspace root when the notebook is inside it, else beside it. */
export function notebookVenvParent(notebookPath: string, rootPath: string | null): string {
  if (rootPath && isPathInsideOrEqual(rootPath, notebookPath)) {
    return rootPath
  }
  return notebookPath.slice(
    0,
    Math.max(notebookPath.lastIndexOf('/'), notebookPath.lastIndexOf('\\'))
  )
}

/** The interpreter inside a venv created at `venvPath`. */
export function venvInterpreterPath(venvPath: string, windows: boolean): string {
  return windows ? `${venvPath}\\Scripts\\python.exe` : `${venvPath}/bin/python`
}
