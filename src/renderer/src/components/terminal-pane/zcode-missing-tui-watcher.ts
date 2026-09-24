import { toast } from 'sonner'
import { isZCodeMissingTuiOutput } from '../../../../shared/zcode-missing-tui'
import { translate } from '@/i18n/i18n'
import { subscribeToPtyData } from './pty-data-sidecar-subscriptions'

/**
 * Tell the user when their `zcode` is a build with no terminal UI.
 *
 * ZCode's desktop bundle answers `--version`, runs `-p`, and passes `zcode doctor`, so Orca
 * detects it, launches it, and installs hooks against it — all successfully. Only the
 * interactive session fails, leaving a bare Node stack trace in the pane that reads as a
 * broken Orca integration. This turns that into an explanation.
 */

// Why a byte budget and not a timer: the failure is a module-resolution error the runtime
// hits before it renders anything, so it is in the first chunk or it is not coming. Capping
// the scan keeps a healthy pane's output off this path entirely after startup.
const SCAN_BUDGET_BYTES = 8_192

/** Watch one freshly launched ZCode pane's first output for the missing-TUI failure. */
export function startZCodeMissingTuiWatcher(ptyId: string): () => void {
  let scanned = 0
  let carry = ''
  let disposed = false
  let unsubscribe: (() => void) | undefined

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    unsubscribe?.()
  }

  unsubscribe = subscribeToPtyData(ptyId, (data) => {
    if (disposed) {
      return
    }
    scanned += data.length
    // Why carry: the error can straddle a chunk boundary, and it is one line, so a small
    // overlap is enough to rejoin it without retaining scrollback.
    const window = carry + data
    if (isZCodeMissingTuiOutput(window)) {
      showZCodeMissingTuiNotice()
      dispose()
      return
    }
    if (scanned >= SCAN_BUDGET_BYTES) {
      dispose()
      return
    }
    carry = window.slice(-256)
  })

  return dispose
}

export function showZCodeMissingTuiNotice(): void {
  toast.error(
    translate(
      'auto.components.terminal.pane.zcode.missing.tui.title',
      'This ZCode build has no terminal UI'
    ),
    {
      // Why a stable id: two ZCode panes launched together would otherwise stack the same notice.
      id: 'zcode-missing-tui',
      description: translate(
        'auto.components.terminal.pane.zcode.missing.tui.description',
        "Orca's hooks installed correctly — the `zcode` on your PATH just cannot open a session. The ZCode desktop app bundles the agent runtime without its terminal UI. Install a `zcode` that ships the TUI, then run `zcode` outside Orca to confirm."
      ),
      duration: 20_000
    }
  )
}
