import { venvInterpreterPath } from '../../../../shared/notebook-venv-location'

/** Quotes a path for a shell; single quotes are literal in POSIX shells and PowerShell. */
function shellQuote(path: string, windows: boolean): string {
  return windows ? `'${path.replaceAll("'", "''")}'` : `'${path.replaceAll("'", "'\\''")}'`
}

/** PowerShell runs a quoted program path only through `&`. */
function shellProgram(path: string, windows: boolean): string {
  return windows ? `& ${shellQuote(path, windows)}` : shellQuote(path, windows)
}

/** Install's command as a shell line to copy; Install itself spawns without a shell. */
export function ipykernelInstallCommand(
  python: string,
  windows = navigator.userAgent.includes('Windows')
): string {
  return `${shellProgram(python, windows)} -m pip install -U ipykernel`
}

/** Creating the notebook's venv as a shell line to copy, mirroring `createVirtualEnvironment`. */
export function venvSetupCommand(
  python: string,
  venvParent: string,
  windows = navigator.userAgent.includes('Windows')
): string {
  const venv = windows ? `${venvParent}\\.venv` : `${venvParent}/.venv`
  const install = ipykernelInstallCommand(venvInterpreterPath(venv, windows), windows)
  // Windows PowerShell 5.1 has no `&&`.
  return `${shellProgram(python, windows)} -m venv ${shellQuote(venv, windows)}${windows ? ';' : ' &&'} ${install}`
}
