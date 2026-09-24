import { ColdRestoreReplayWriter } from './cold-restore-replay-writer'
import { DAEMON_RESTORE_SCROLLBACK_ROWS } from './daemon-restore-scrollback-depth'
import {
  DurableHistoryReplayEmulator,
  type NormalBufferHead
} from './durable-history-replay-emulator'
import { isValidTerminalHistorySize } from './terminal-history-dimensions'
import { getRecoveredHistorySeedSegments } from './terminal-history-seed-segments'
import { replayTerminalSnapshot } from './terminal-checkpoint-serializer'
import { RESET_GRAPHIC_RENDITION } from '../../shared/terminal-mode-reset-profiles'
import type { ColdRestoreInfo } from './terminal-history-cold-restore-info'
import type { PendingOutputRecord, TerminalModes, TerminalSnapshot } from './types'

// Why: the head's serializer ends on the replay's pen and open hyperlink; the live body assumes defaults.
const OLDER_ROWS_SEAM = `${RESET_GRAPHIC_RENDITION}\x1b]8;;\x1b\\`

/** Live is the authority for everything it holds; disk only adds normal-buffer rows live evicted. */
export async function buildDurableCheckpointSnapshot(opts: {
  liveSnapshot: TerminalSnapshot
  restoreInfo: ColdRestoreInfo | null
  pendingRecords?: readonly PendingOutputRecord[]
  /** Records span the live session's whole life, so restoreInfo is the base it was seeded from. */
  pendingRecordsAreComplete?: boolean
  scrollbackRows?: number
}): Promise<TerminalSnapshot> {
  const { liveSnapshot, restoreInfo } = opts
  const pendingRecords = opts.pendingRecords ?? []
  const depth = Math.min(
    opts.scrollbackRows ?? DAEMON_RESTORE_SCROLLBACK_ROWS,
    DAEMON_RESTORE_SCROLLBACK_ROWS
  )
  if (liveSnapshot.scrollbackLines > depth) {
    // Why: live alone is deeper than requested, so disk rows cannot contribute.
    return await boundLiveSnapshot(liveSnapshot, depth)
  }
  if (!restoreInfo && pendingRecords.length === 0) {
    return liveSnapshot
  }
  if (
    restoreInfo &&
    pendingRecords.length === 0 &&
    depth === DAEMON_RESTORE_SCROLLBACK_ROWS &&
    diskCheckpointAgreesWithLive(restoreInfo, liveSnapshot)
  ) {
    return diskCheckpointWithLiveIdentity(restoreInfo, liveSnapshot)
  }

  // Why the base's dims: a cold restore spawns and seeds the live session at them.
  const emulator = new DurableHistoryReplayEmulator({
    cols: restoreInfo?.cols ?? liveSnapshot.cols,
    rows: restoreInfo?.rows ?? liveSnapshot.rows,
    scrollback: depth
  })
  const replay = new ColdRestoreReplayWriter(emulator)
  try {
    // Why not seed the live window when there is no disk history: pending records
    // are the raw stream. Replaying them on top of the already-truncated live
    // snapshot would duplicate the newest rows and evict the older recoverable ones.
    if (restoreInfo) {
      // Why the seed on a first fold: live got exactly those bytes, so both copies' rows line up
      // even when the base was a dead TUI's alt screen.
      const segments = opts.pendingRecordsAreComplete
        ? getRecoveredHistorySeedSegments(restoreInfo)
        : restoreSegments(restoreInfo)
      for (const segment of segments) {
        if (!(await replay.write(segment))) {
          return liveSnapshot
        }
      }
      // Why normal only: persisted ranges index the base's active buffer, and only normal rows survive the rebase.
      if (!restoreInfo.modes.alternateScreen) {
        emulator.setRestoredOscLinks(restoreInfo.oscLinks)
      }
    }
    if (!(await replayPendingRecords(replay, pendingRecords))) {
      return liveSnapshot
    }
    if (!isValidTerminalHistorySize(liveSnapshot.cols, liveSnapshot.rows)) {
      return liveSnapshot
    }
    // Why: rows are counted from the bottom, so both buffers must wrap on the same grid.
    await replay.resize(liveSnapshot.cols, liveSnapshot.rows)
    const head = emulator.serializeNormalBufferHead(
      liveSnapshot.scrollbackLines + liveSnapshot.rows
    )
    return {
      ...rebaseOnOlderRows(liveSnapshot, head),
      ...(!liveSnapshot.cwd && restoreInfo?.cwd ? { cwd: restoreInfo.cwd } : {}),
      ...(!liveSnapshot.lastTitle && restoreInfo?.lastTitle
        ? { lastTitle: restoreInfo.lastTitle }
        : {})
    }
  } catch (error) {
    console.warn('[history] durable snapshot rebuild failed:', error)
    return liveSnapshot
  } finally {
    emulator.dispose()
  }
}

/** True when disk already holds live's grid, modes and alt frame, so a rebase would change nothing. */
function diskCheckpointAgreesWithLive(info: ColdRestoreInfo, live: TerminalSnapshot): boolean {
  return (
    info.cols === live.cols &&
    info.rows === live.rows &&
    info.rehydrateSequences === live.rehydrateSequences &&
    TERMINAL_MODE_KEYS.every((key) => info.modes[key] === live.modes[key]) &&
    (!live.modes.alternateScreen || info.snapshotAnsi === live.snapshotAnsi)
  )
}

const TERMINAL_MODE_KEYS = [
  'bracketedPaste',
  'mouseTracking',
  'mouseTrackingMode',
  'sgrMouseMode',
  'sgrMousePixelsMode',
  'applicationCursor',
  'alternateScreen',
  'kittyKeyboardFlags'
] as const satisfies readonly (keyof TerminalModes)[]

function diskCheckpointWithLiveIdentity(
  info: ColdRestoreInfo,
  live: TerminalSnapshot
): TerminalSnapshot {
  const { terminalOwner: _diskOwner, pendingOutputSeq: _diskSeq, ...disk } = info
  return {
    ...disk,
    // Why: a normal-screen snapshotAnsi already holds its scrollback.
    scrollbackAnsi: info.modes.alternateScreen ? info.scrollbackAnsi : '',
    scrollbackLines:
      info.scrollbackLines ?? Math.max(0, countAnsiRows(info.scrollbackAnsi) - info.rows),
    ...(live.frameRestoreAnsi ? { frameRestoreAnsi: live.frameRestoreAnsi } : {}),
    ...(live.terminalOwner ? { terminalOwner: live.terminalOwner } : {}),
    ...(live.outputSequence !== undefined ? { outputSequence: live.outputSequence } : {})
  }
}

async function boundLiveSnapshot(live: TerminalSnapshot, depth: number): Promise<TerminalSnapshot> {
  const emulator = await replayTerminalSnapshot(live, { scrollbackRows: depth })
  try {
    return {
      ...emulator.getSnapshot(),
      ...(live.terminalOwner ? { terminalOwner: live.terminalOwner } : {}),
      ...(live.outputSequence !== undefined ? { outputSequence: live.outputSequence } : {})
    }
  } finally {
    emulator.dispose()
  }
}

function restoreSegments(restoreInfo: ColdRestoreInfo): string[] {
  return [
    // Why alt only: a normal-screen snapshotAnsi already holds its scrollback.
    restoreInfo.modes.alternateScreen ? restoreInfo.scrollbackAnsi : '',
    restoreInfo.rehydrateSequences,
    restoreInfo.snapshotAnsi,
    restoreInfo.pendingEscapeTailAnsi ?? ''
  ]
}

function rebaseOnOlderRows(live: TerminalSnapshot, head: NormalBufferHead): TerminalSnapshot {
  if (head.rowCount === 0) {
    return live
  }
  // Why a screenful of newlines then home: it scrolls every older row into
  // scrollback and leaves the blank, homed screen a fresh live replay expects.
  const prefix = `${head.ansi}${OLDER_ROWS_SEAM}${'\r\n'.repeat(live.rows)}\x1b[H`
  if (live.modes.alternateScreen) {
    // Why links untouched: they index the alt screen, which older rows never enter.
    return {
      ...live,
      scrollbackAnsi: prefix + live.scrollbackAnsi,
      scrollbackLines: live.scrollbackLines + head.rowCount
    }
  }
  return {
    ...live,
    snapshotAnsi: prefix + live.snapshotAnsi,
    oscLinks: [
      ...head.oscLinks,
      ...(live.oscLinks ?? []).map((link) => ({ ...link, row: link.row + head.rowCount }))
    ],
    scrollbackLines: live.scrollbackLines + head.rowCount
  }
}

async function replayPendingRecords(
  replay: ColdRestoreReplayWriter,
  records: readonly PendingOutputRecord[]
): Promise<boolean> {
  for (const record of records) {
    if (record.kind === 'output') {
      if (!(await replay.write(record.data))) {
        return false
      }
      continue
    }
    if (record.kind === 'resize') {
      if (!isValidTerminalHistorySize(record.cols, record.rows)) {
        return false
      }
      await replay.resize(record.cols, record.rows)
      continue
    }
    await replay.clearScrollback()
  }
  return true
}

function countAnsiRows(ansi: string): number {
  if (ansi.length === 0) {
    return 0
  }
  return ansi.split(/\r\n|\n|\r/).filter((row) => row.length > 0).length
}
