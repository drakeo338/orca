export const ORCA_CLI_INSTALL_STATE_EVENT = 'orca:cli-install-state'

/** Fired after every CLI install, remove, or pre-setup check so each mounted status reader re-reads. */
export function notifyOrcaCliInstallStateChanged(): void {
  window.dispatchEvent(new CustomEvent(ORCA_CLI_INSTALL_STATE_EVENT))
}
