/** Run after guest startup files, which may replace PATH. A missing CLI never blocks the shell. */
export const WSL_MANAGED_CLI_PATH = `if [ -n "\${ORCA_WSL_CLI_DIR:-}" ]; then
  if [ -d "$ORCA_WSL_CLI_DIR" ]; then
    export PATH="$ORCA_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Orca CLI is unavailable: cannot read %s. Check WSL Windows-drive mounts.\\n' "$ORCA_WSL_CLI_DIR" >&2
  fi
fi`
