// What a Claude transcript's rows MEAN as a graph, and what makes a branch
// provable from one snapshot of them. Nothing here touches the filesystem: the
// readers in `claude-transcript-branch-proof.ts` decide which bytes to feed it.

const MAX_CLAUDE_TRANSCRIPT_ANCESTRY = 10_000

class ClaudeTranscriptTipMissingError extends Error {
  constructor() {
    super('Claude transcript branch proof failed: no main-chain message')
  }
}

type TranscriptNode = {
  parentUuid: string | null
  sessionId: string | null
  /** First line where this UUID was observed in the append-only transcript. */
  lineIndex: number
  /** UUIDs from result/init/stream frames and sidechains are never leaves. */
  disallowedLeaf: boolean
  /** A row `readClaudeTranscriptEntryUuid` accepts. */
  message: boolean
}

export type ClaudeTranscriptBranchProof = {
  leafUuid: string
  relation: 'initial' | 'same' | 'descendant'
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function validEntryUuid(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return null
  }
  const hasControlCharacter = [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })
  return value === value.trim() && !hasControlCharacter ? value : null
}

/** A main-chain user or assistant message: the only row a durable leaf may name. */
export function readClaudeTranscriptEntryUuid(value: Record<string, unknown>): string | null {
  return value.isSidechain === true ||
    value.parent_tool_use_id != null ||
    (value.type !== 'user' && value.type !== 'assistant')
    ? null
    : validEntryUuid(value.uuid)
}

function transcriptError(reason: string): Error {
  return new Error(`Claude transcript branch proof failed: ${reason}`)
}

export class ClaudeTranscriptTailIncompleteError extends Error {
  constructor() {
    super('Claude transcript branch proof failed: malformed JSONL')
    this.name = 'ClaudeTranscriptTailIncompleteError'
  }
}

/** The sampled cursor is no longer present, so a root proof may still recover safely. */
export class ClaudeTranscriptPreviousCursorMissingError extends Error {
  constructor() {
    super(
      'Claude transcript branch proof failed: previous cursor is missing from the session graph'
    )
    this.name = 'ClaudeTranscriptPreviousCursorMissingError'
  }
}

function proveMainLineAncestry(
  nodes: Map<string, TranscriptNode>,
  startUuid: string,
  providerSessionId: string
): void {
  const visited = new Set<string>()
  let cursor: string | null = startUuid
  for (let depth = 0; cursor !== null && depth < MAX_CLAUDE_TRANSCRIPT_ANCESTRY; depth += 1) {
    if (visited.has(cursor)) {
      throw transcriptError('cycle in parentUuid ancestry')
    }
    visited.add(cursor)
    const node = nodes.get(cursor)
    if (!node || node.sessionId !== providerSessionId) {
      throw transcriptError(`missing ancestor ${cursor}`)
    }
    if (node.disallowedLeaf) {
      throw transcriptError(`ancestor ${cursor} is not on the main transcript`)
    }
    cursor = node.parentUuid
  }
  if (cursor !== null) {
    throw transcriptError('ancestry exceeds the bounded proof limit')
  }
}

function proveAppendOrder(nodes: Map<string, TranscriptNode>): void {
  for (const node of nodes.values()) {
    if (!node.parentUuid) {
      continue
    }
    const parent = nodes.get(node.parentUuid)
    if (parent && parent.lineIndex >= node.lineIndex) {
      throw transcriptError('parent row follows descendant')
    }
  }
}

type BranchProofInput = {
  providerSessionId: string
  previousLeafUuid: string | null
}

/**
 * The tip is the file's last main-chain message. Claude's `last-prompt` marker is
 * never read: it is written sporadically, lags turns behind, and usually names a
 * hook or attachment row that later messages do not descend from.
 */
function createBranchProof(input: BranchProofInput) {
  const nodes = new Map<string, TranscriptNode>()
  let leafUuid: string | null = null
  return { add, finish, ancestryChain }

  function add(line: string, index: number, terminated: boolean): void {
    if (!line.trim()) {
      return
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      if (!terminated) {
        throw new ClaudeTranscriptTailIncompleteError()
      }
      throw transcriptError('malformed JSONL')
    }
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw transcriptError('non-object record')
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The parsed value is a non-array object checked above.
    const row = record as Record<string, unknown>
    const uuid = nonEmptyString(row.uuid)
    if (!uuid) {
      return
    }
    const parentUuid = row.parentUuid === null ? null : nonEmptyString(row.parentUuid)
    if (row.parentUuid !== null && !parentUuid) {
      throw transcriptError(`record ${uuid} has no parent identity`)
    }
    const sessionId = nonEmptyString(row.sessionId)
    const existing = nodes.get(uuid)
    const disallowedLeaf =
      row.isSidechain === true ||
      row.parent_tool_use_id != null ||
      row.type === 'result' ||
      row.type === 'stream_event' ||
      (row.type === 'system' && row.subtype === 'init')
    if (
      existing &&
      (existing.parentUuid !== parentUuid ||
        existing.sessionId !== sessionId ||
        existing.disallowedLeaf !== disallowedLeaf)
    ) {
      throw transcriptError(`record ${uuid} has conflicting ancestry`)
    }
    const entryUuid = readClaudeTranscriptEntryUuid(row)
    nodes.set(uuid, {
      parentUuid,
      sessionId,
      lineIndex: existing?.lineIndex ?? index,
      disallowedLeaf,
      message: existing?.message ?? entryUuid !== null
    })
    leafUuid = entryUuid ?? leafUuid
  }

  /** Older builds saved marker-named hook and attachment rows as the leaf; the
   *  conversation such a row names ends at its nearest message ancestor. */
  function messageAnchor(uuid: string): string {
    let cursor: string | null = uuid
    for (let depth = 0; cursor !== null && depth < MAX_CLAUDE_TRANSCRIPT_ANCESTRY; depth += 1) {
      const node = nodes.get(cursor)
      if (!node) {
        break
      }
      if (node.message) {
        return cursor
      }
      cursor = node.parentUuid
    }
    return uuid
  }

  function finish(): ClaudeTranscriptBranchProof {
    if (!leafUuid) {
      throw new ClaudeTranscriptTipMissingError()
    }
    const leaf = nodes.get(leafUuid)
    if (!leaf || leaf.sessionId !== input.providerSessionId || leaf.disallowedLeaf) {
      throw transcriptError('latest message is missing from the session graph')
    }
    const previousLeafUuid = input.previousLeafUuid
    if (!previousLeafUuid) {
      proveMainLineAncestry(nodes, leafUuid, input.providerSessionId)
      // A branch proof is based on an append-only snapshot. A child that appears
      // before its claimed parent is not a post-snapshot descendant observation;
      // accepting that graph would turn reordered/torn rows into durable ancestry.
      proveAppendOrder(nodes)
      return { leafUuid, relation: 'initial' }
    }
    const previous = nodes.get(previousLeafUuid)
    if (!previous) {
      throw new ClaudeTranscriptPreviousCursorMissingError()
    }
    if (previous.sessionId !== input.providerSessionId || previous.disallowedLeaf) {
      throw transcriptError('previous cursor is not on the main transcript')
    }
    // The latest message can be equal to, or descend from, a sampled cursor. In
    // either case prove the sampled cursor's own ancestry before accepting it;
    // otherwise a cursor that descended through a parent-tool-use sidechain
    // could be persisted and resumed as if it were on the main transcript.
    proveMainLineAncestry(nodes, previousLeafUuid, input.providerSessionId)
    const anchorUuid = messageAnchor(previousLeafUuid)
    if (leafUuid === anchorUuid) {
      proveAppendOrder(nodes)
      return { leafUuid, relation: 'same' }
    }
    const visited = new Set<string>()
    let cursor: string | null = leafUuid
    for (let depth = 0; cursor !== null && depth < MAX_CLAUDE_TRANSCRIPT_ANCESTRY; depth += 1) {
      if (visited.has(cursor)) {
        throw transcriptError('cycle in parentUuid ancestry')
      }
      visited.add(cursor)
      const node = nodes.get(cursor)
      if (!node || node.sessionId !== input.providerSessionId) {
        throw transcriptError(`missing ancestor ${cursor}`)
      }
      if (node.disallowedLeaf) {
        throw transcriptError(`ancestor ${cursor} is not on the main transcript`)
      }
      cursor = node.parentUuid
      if (cursor === anchorUuid) {
        proveAppendOrder(nodes)
        return { leafUuid, relation: 'descendant' }
      }
    }
    if (cursor !== null) {
      throw transcriptError('ancestry exceeds the bounded proof limit')
    }
    throw transcriptError('latest message is on a sibling branch')
  }

  /** Uuids from the leaf back to (but excluding) the anchor, leaf first. Only
   *  meaningful after `finish()`, which is what proved the walk reaches the anchor.
   *
   *  A walk that does NOT reach the anchor throws rather than returning empty:
   *  empty is the caller's "nothing followed the anchor", and answering that for
   *  a broken walk would report non-delivery for records we never looked at. */
  function ancestryChain(leafUuid: string, requestedAnchorUuid: string): string[] {
    const anchorUuid = messageAnchor(requestedAnchorUuid)
    const chain: string[] = []
    let cursor: string | null = leafUuid
    for (let depth = 0; cursor !== null && cursor !== anchorUuid; depth += 1) {
      if (depth >= MAX_CLAUDE_TRANSCRIPT_ANCESTRY || !nodes.has(cursor)) {
        throw transcriptError(`ancestry chain does not reach anchor ${anchorUuid}`)
      }
      chain.push(cursor)
      cursor = nodes.get(cursor)?.parentUuid ?? null
    }
    if (cursor !== anchorUuid) {
      throw transcriptError(`ancestry chain does not reach anchor ${anchorUuid}`)
    }
    return chain
  }
}

export { ClaudeTranscriptTipMissingError, createBranchProof }
export type { BranchProofInput }
