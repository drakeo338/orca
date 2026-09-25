// Input modes a program arms for itself and must disarm on exit. `?2004` and `?1`
// are left out because bash, zsh and PowerShell arm them at their own prompts.
// `?66` is DECNKM, not `ESC =`: zle's smkx (`ESC[?1h ESC=`) stays untracked.
const TRACKED_PRIVATE_MODES = new Set([9, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 66])
// Why one key per screen: kitty flags are per screen, so ownership must be too.
const KITTY_MAIN = -1
const KITTY_ALT = -2
// Matches xterm.js's eviction limit, so the model drops the same entries.
const KITTY_STACK_LIMIT = 16

/**
 * Which tracked input modes are armed, and which of those the shell's own prompt
 * armed before the running command started (OSC 133;C). A program that dies
 * with a mode it armed itself leaves it to the recovery barrier.
 */
export class TerminalArmedInputModes {
  private readonly armed = new Set<number>()
  private readonly shellOwned = new Set<number>()
  // Armed outside a command (before any marker, or at a prompt): the shell's or host's,
  // e.g. ConPTY's ?1004h. A mode a program leaked past its exit never lands here.
  private readonly hostArmed = new Set<number>()
  private inCommand = false
  // The host-armed modes still on at the last OSC 133;C; the ground re-asserts them.
  private baselinePrivateModes: number[] = []
  private baselineKittyFlags = 0
  // Mirrors xterm.js's kitty state: current flags, the other screen's flags, and a stack per screen.
  private kittyFlags = 0
  private kittyMainFlags = 0
  private kittyAltFlags = 0
  private kittyMainStack: number[] = []
  private kittyAltStack: number[] = []
  private onAlternateScreen = false

  get hasProgramArmedModes(): boolean {
    for (const mode of this.armed) {
      if (!this.shellOwned.has(mode)) {
        return true
      }
    }
    return false
  }

  /** Returns true when the mode went from disarmed to armed. */
  applyPrivateMode(param: number, enabled: boolean): boolean {
    if (!TRACKED_PRIVATE_MODES.has(param)) {
      return false
    }
    return this.setArmed(param, enabled)
  }

  /** `?47`/`?1047`/`?1049`: xterm swaps the kitty flags on every set or reset. */
  switchScreen(alternate: boolean): void {
    if (alternate) {
      this.kittyMainFlags = this.kittyFlags
      this.kittyFlags = this.kittyAltFlags
    } else {
      this.kittyAltFlags = this.kittyFlags
      this.kittyFlags = this.kittyMainFlags
    }
    this.armed.delete(this.kittyKey())
    this.onAlternateScreen = alternate
    // Why no ownership change: the swap only uncovers flags an earlier writer set.
    if (this.kittyFlags > 0) {
      this.armed.add(this.kittyKey())
    }
  }

  /** `CSI > flags u` push, `CSI < n u` pop, `CSI = flags ; mode u` set. Returns true on a fresh arm. */
  applyKittyKeyboard(prefix: string, params: string): boolean {
    const separator = params.indexOf(';')
    const first = Number(separator === -1 ? params : params.slice(0, separator)) || 0
    const stack = this.onAlternateScreen ? this.kittyAltStack : this.kittyMainStack
    if (prefix === '<') {
      for (let count = Math.max(1, first); count > 0 && stack.length > 0; count -= 1) {
        this.kittyFlags = stack.pop() ?? 0
      }
      if (stack.length === 0) {
        this.kittyFlags = 0
      }
      // Why no ownership change: a pop only uncovers flags an earlier writer set.
      if (this.kittyFlags === 0) {
        this.setArmed(this.kittyKey(), false)
      } else {
        this.armed.add(this.kittyKey())
      }
      return false
    }
    if (prefix === '>') {
      if (stack.length >= KITTY_STACK_LIMIT) {
        stack.shift()
      }
      stack.push(this.kittyFlags)
      this.kittyFlags = first
    } else {
      const mode = separator === -1 ? 1 : Number(params.slice(separator + 1)) || 1
      this.kittyFlags =
        mode === 2 ? this.kittyFlags | first : mode === 3 ? this.kittyFlags & ~first : first
    }
    return this.setArmed(this.kittyKey(), this.kittyFlags > 0)
  }

  /** The prompt is done: anything armed now belongs to the shell, not the command. */
  markCommandStart(): void {
    this.shellOwned.clear()
    for (const mode of this.armed) {
      this.shellOwned.add(mode)
    }
    this.baselinePrivateModes = [...this.armed].filter(
      (mode) => mode >= 0 && this.hostArmed.has(mode)
    )
    this.baselineKittyFlags =
      !this.onAlternateScreen && this.hostArmed.has(KITTY_MAIN) ? this.kittyFlags : 0
    this.inCommand = true
  }

  /** OSC 133;A or D: enables from here to the next C are the shell's. */
  markPromptBoundary(): void {
    this.inCommand = false
  }

  /** After a ground: re-arms the 133;C baseline as shell-owned and returns the bytes that do it. */
  reassertCommandBaseline(): string {
    let bytes = ''
    if (this.baselinePrivateModes.length > 0) {
      bytes += `\x1b[?${this.baselinePrivateModes.join(';')}h`
      for (const mode of this.baselinePrivateModes) {
        this.applyPrivateMode(mode, true)
        this.shellOwned.add(mode)
      }
    }
    if (this.baselineKittyFlags > 0 && !this.onAlternateScreen) {
      bytes += `\x1b[>${this.baselineKittyFlags}u`
      this.applyKittyKeyboard('>', String(this.baselineKittyFlags))
      this.shellOwned.add(KITTY_MAIN)
    }
    return bytes
  }

  reset(): void {
    this.armed.clear()
    this.shellOwned.clear()
    this.hostArmed.clear()
    this.inCommand = false
    this.baselinePrivateModes = []
    this.baselineKittyFlags = 0
    this.kittyFlags = 0
    this.kittyMainFlags = 0
    this.kittyAltFlags = 0
    this.kittyMainStack = []
    this.kittyAltStack = []
    this.onAlternateScreen = false
  }

  private kittyKey(): number {
    return this.onAlternateScreen ? KITTY_ALT : KITTY_MAIN
  }

  private setArmed(mode: number, armed: boolean): boolean {
    if (!armed) {
      this.armed.delete(mode)
      this.shellOwned.delete(mode)
      this.hostArmed.delete(mode)
      return false
    }
    // Why: an enable while a command runs hands the mode to that command.
    this.shellOwned.delete(mode)
    if (this.inCommand) {
      this.hostArmed.delete(mode)
    } else {
      this.hostArmed.add(mode)
    }
    if (this.armed.has(mode)) {
      return false
    }
    this.armed.add(mode)
    return true
  }
}
