import { userInfo } from 'node:os'

export function resolveAccountLoginShell(
  platform: NodeJS.Platform,
  accountLoginShell?: string | null
): string | null {
  if (accountLoginShell !== undefined) {
    return accountLoginShell
  }
  if (platform === 'win32') {
    return null
  }
  try {
    return userInfo().shell ?? null
  } catch {
    return null
  }
}
