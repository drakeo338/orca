# CLI access in Orca-managed WSL shells

Every Windows PTY environment (`buildPtyHostEnv`) exports `ORCA_WSL_CLI_DIR`,
a directory under `<userData>/wsl-managed-cli/<content hash>` holding an
`orca-ide` (packaged) or `orca-dev` (development) launcher and its PowerShell
bridge. `WSLENV` `/p` translates the path with the distro's own mount settings.
Nothing is installed in the guest; `~/.local/bin`, shell profiles, and the
Windows user PATH are untouched. External WSL shells still need Settings →
General registration.

- **Scripts** reuse `wsl-cli-scripts.ts`. The colocated launcher finds its bridge
  next to itself and PowerShell by its Windows path, so neither guest PATH nor
  the automount root matters. The bridge pins this app's user-data directory
  and, in development, runs Electron as Node on `out/cli/index.js` directly.
- **Content addressing** follows `shell-wrapper-content-address.ts`: builds that
  share user data never overwrite each other, and a present file is complete
  because each one lands by rename. Old directories are not collected.
- **PATH restore** (`WSL_MANAGED_CLI_PATH`) runs after user startup files: in the
  bash rcfile, the local zsh first-prompt hook, and the renderer's WSL skill-setup
  command. Other `buildWslLoginShellCommand` callers (git, Codex) do not get it.
- **Failure never blocks a shell.** A missing runtime or unwritable directory
  leaves the variable unset (logged on the host); an unreadable mount prints
  one warning in the guest. Non-bash/zsh login shells simply lack the CLI.

The `terminal.managed-wsl-cli.v1` runtime capability lets clients skip the WSL
registration prerequisite for skill setup on hosts that have this.

Run the opt-in end-to-end test on Windows with `ORCA_BACKGROUND_LAUNCH=1`,
`ORCA_TEST_MANAGED_WSL=1`, and optionally `ORCA_TEST_WSL_DISTRO=<distro>`.
