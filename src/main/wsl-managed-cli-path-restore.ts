/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${ORCA_WSL_CLI_DIR:-}" ]; then
  if [ -x "$ORCA_WSL_CLI_DIR/\${ORCA_CLI_COMMAND:-}" ]; then
    case "$PATH" in
      "$ORCA_WSL_CLI_DIR"|"$ORCA_WSL_CLI_DIR:"*) ;;
      *) export PATH="$ORCA_WSL_CLI_DIR\${PATH:+:$PATH}" ;;
    esac
  else
    printf 'Orca CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$ORCA_WSL_CLI_DIR/\${ORCA_CLI_COMMAND:-}" >&2
  fi
fi`
