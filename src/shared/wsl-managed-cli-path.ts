/** Run after guest startup files, which may replace PATH. No permanent shell changes. */
export const WSL_MANAGED_CLI_PATH = `if [ -n "\${WSL_DISTRO_NAME:-}" ]; then
if [ -n "\${ORCA_WSL_CLI_ERROR:-}" ]; then
  printf 'Orca managed WSL CLI: %s\\n' "$ORCA_WSL_CLI_ERROR" >&2
  exit 1
fi
if [ -n "\${ORCA_WSL_CLI_DIR:-}" ]; then
  if [ -x "$ORCA_WSL_CLI_DIR/orca-dev" ]; then
    export ORCA_CLI_COMMAND=orca-dev
  elif [ -x "$ORCA_WSL_CLI_DIR/orca-ide" ]; then
    export ORCA_CLI_COMMAND=orca-ide
  else
    printf 'Orca managed WSL CLI is unavailable at %s. Check WSL Windows-drive mounts and relaunch.\\n' "$ORCA_WSL_CLI_DIR" >&2
    exit 1
  fi
  export PATH="$ORCA_WSL_CLI_DIR\${PATH:+:$PATH}"
fi
fi`
