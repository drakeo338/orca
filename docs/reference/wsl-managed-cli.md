# CLI access in Orca-managed WSL shells

Windows child environment assembly prepares launcher files beneath
`<userData>/wsl-managed-cli/<content hash>`. `WSLENV` translates that directory
using the selected distro's mount configuration. No guest installation command
runs, and neither `~/.local/bin`, shell profiles, nor the Windows user PATH changes.

The bash launcher and PowerShell bridge reuse `wsl-cli-scripts.ts`. The bridge
pins the owning Windows user-data directory; development launches invoke the
current runtime and compiled CLI directly, avoiding an extra batch-file argument
boundary. Managed bridges forward stdout/stderr explicitly so hidden Windows
children work in guest pipelines. PowerShell is resolved from the host's Windows
directory through `wslpath`, independently of the guest PATH and automount root.

The directory hash covers the scripts, runtime path, CLI entrypoint, and app
identity. Separate app profiles cannot overwrite each other's files. Identical
concurrent writers publish complete files by rename. Relaunch checks file contents,
repairs missing files, and refuses altered files or symlinks. Old directories remain
available to existing shells. There is no background provisioning loop or probe
on terminal input.

## Launch coverage

- `prependOrcaCliDirToChildPath` prepares the environment for Windows managed
  children, including native PowerShell outer terminals used by skill setup.
- The WSL bash rcfile restores the directory after profiles. The local zsh wrapper
  restores it at its first prompt, after all user startup files. Unsupported or
  missing interactive wrappers refuse launch rather than silently promise CLI access.
- `buildWslLoginShellCommand` restores it before command payloads, including the
  existing encoded PowerShell-to-WSL skill installer command.
- PTY agent launches share this environment assembly with regular terminal panes.
  The durable Claude and Codex structured-session resolvers explicitly reject
  WSL locations. Their native-host behavior remains separate. Source-control AI
  subprocesses use their own restricted environment and are not covered by this
  terminal capability; this change does not claim CLI availability there.
- SSH wrappers and remote registration are not changed. The optional
  `terminal.managed-wsl-cli.v1` runtime capability identifies hosts containing
  this implementation; old clients ignore it.

WSL must be available and able to mount the app-owned Windows directory and run
Windows PowerShell through interop. Failures to prepare or access the directory
are reported in the guest terminal, and bridge failures retain their exit status.
This is not global CLI registration: external WSL shells still use Settings →
General registration when they want the command on their own PATH.

## Windows 2 evidence, 2026-09-24

Ubuntu-24.04 was the default and only installed distro, running WSL 2. The initial
isolated shell used `HOME=/tmp/orca-cli-unregistered-repro`,
`PATH=/usr/bin:/bin`, and `bash --noprofile --norc`. Neither `orca-ide` nor
`orca-dev` resolved.

`wsl-managed-cli.wsl.test.ts` uses a disposable home containing a profile that
resets PATH to `/usr/bin:/bin`. It executes the actual Windows bridge from both
the login-command bootstrap and Orca's bash rcfile. It verifies quoted arguments,
the owning app-data path, terminal identity, piped JSON, stderr, exit status,
external-shell non-resolution, missing distro, missing interop executable, and
missing managed-directory failures. The test compares external PATH and hashes
of the existing profiles, launchers, and registration bridge before and after.
Both explicit `Ubuntu-24.04` and default-distro selection passed.

A freshly built Electron app ran with an isolated profile and
`ORCA_BACKGROUND_LAUNCH=1`. CDP confirmed this workspace's app identity. Real
managed WSL terminals in this git worktree and a disposable WSL folder project
resolved `orca-dev` from the isolated profile, ran `--help`, and returned that
app's runtime ID from `status --json`, distinct from the user's existing app.
The actual renderer skill-command builder was also used to launch PowerShell →
WSL → CLI; it returned the same runtime ID. A packaged `orca-ide` launcher,
using the installed Windows executable and isolated app identity, passed help
and status as well. After app relaunch, new terminals used the new script hash.

Focused regression tests include six concurrent provisioning processes, separate
app identities, host-path updates, missing-file repair, modified-file refusal,
native-host PATH behavior, WSL argument construction, and registration behavior.
Run the opt-in Windows test with `ORCA_BACKGROUND_LAUNCH=1`,
`ORCA_TEST_MANAGED_WSL=1`, and optionally `ORCA_TEST_WSL_DISTRO=Ubuntu-24.04`.

Limitations: zsh is not installed in this distro; live zsh, a second real distro,
custom automount roots, and an actual disabled-interop installation were not
tested. The failure fixture points to a nonexistent PowerShell executable rather
than disabling the user's interop. No paid agent session was started. No live
SSH host was exercised. The full suite and release packaging were not run.

Additional Windows suites exposed two daemon tests whose distro expectations
depend on the machine's installed default distro; both still failed with the
original main-branch shell bootstrap restored temporarily. The native wrapper
root suite also expects `/bin/zsh` to receive a POSIX wrapper on Windows, where
that launch configuration is disabled. These are outside the passing focused
suite. The package runner's native dependency rebuild hit a Windows long-path
FileTracker error; checks were run directly with the installed tools. The fresh
Electron build and launches themselves succeeded.

## Integration with PR #22720

At validation, #22720 remained open at
`4b531fefc31ec9c9cb4de1ca6ad46b74ebf699f2`. This launch-side change is based on
main and does not modify or merge that branch.

Merge order: this launch-side PR, then #22720, then the WSL UI follow-up. If
#22720 merges first, the launch-side PR can still merge independently; the UI
follow-up must wait until both implementations are in its base.

The subsequent UI integration is deliberately specified against #22720's code:

1. Extend its existing `isOrcaCliRegistrationRequired` helper in
   `src/renderer/src/lib/agent-skill-cli-prerequisite.ts` with the execution
   host's managed-WSL capability. For managed WSL setup on a capable host, return
   false. For an older paired Windows host, preserve its current WSL prerequisite.
   Do not infer support from the renderer version or the local machine's platform.
2. Feed that same policy to `getAgentSkillCliPrerequisite` in
   `CliSkillRuntimeSetup.tsx`, `use-linear-agent-skill-setup.ts`, onboarding, and
   the skill panels changed by #22720. Covered paths must not call
   `getWslInstallStatus` or `installWsl`, show registration labels, or gate setup
   on the external registration's PATH status. Surface launch errors normally.
3. Extend `agent-skill-cli-runtime-prerequisite.test.ts` to cover explicit/default
   distros on capable hosts without registration calls, and older hosts retaining
   their prerequisite. Extend #22720's onboarding/panel tests for missing,
   stale, and unknown external registration statuses on a capable host.
4. Keep General's explicit Windows/WSL registration controls for external shells.
   Copied commands used outside Orca do not gain this managed environment.
5. Validate the WSL setup panels in a hidden Electron renderer through CDP.
   Keep the separate onboarding Windows-versus-WSL install-target UX gap out of scope.

This PR intentionally does not remove the WSL UI prerequisites before that
integration. There is no UI-completion claim attached to the launch evidence.
