// How one send outcome changes the outbox.
//
// The sibling of `reconcileStructuredAgentSessionOutbox`: that one folds the
// journal's view of a submission into the queue, this one folds the answer to a
// single `agentSession.send`. Both write the same state, so they live together
// and speak the same vocabulary. Pure on purpose — the hook that calls this owns
// the refs, the React state and the storage write, and nothing else decides an
// entry's state.

import type { AgentJournalSubmission } from './agent-session-journal-types'
import type { AgentSessionMutationResult, AgentSessionSendResult } from './agent-session-wire'
import {
  DISPATCH_REJECTED_CANCELLED,
  dispatchRejectionReasonIsInternal,
  dispatchRejectionWasTransportWriteFailure
} from './structured-agent-session-dispatch-rejection'
import {
  classifyStructuredAgentSessionSendFailure,
  reconcileStructuredAgentSessionOutbox,
  requeueStructuredAgentSessionSendRefusal,
  type StructuredAgentSessionOutboxEntry
} from './structured-agent-session-outbox'

export type StructuredAgentSessionSendDisposition = {
  entries: StructuredAgentSessionOutboxEntry[]
  error: string | null
  /** The entry the queue is stuck on, or null when nothing blocks it. Always the
   *  next value, never "unchanged": the caller assigns it verbatim. */
  blockedClientMessageId: string | null
  /** A rejected result arrived before the journal snapshot; Retry must rotate this id. */
  retryWithFreshClientMessageId: string | null
}

type SendDispositionInput = {
  entries: readonly StructuredAgentSessionOutboxEntry[]
  entry: StructuredAgentSessionOutboxEntry
  blockedClientMessageId: string | null
}

function replaceEntryState(
  input: SendDispositionInput,
  state: StructuredAgentSessionOutboxEntry['state']
): StructuredAgentSessionOutboxEntry[] {
  return input.entries.map((candidate) =>
    candidate.clientMessageId === input.entry.clientMessageId ? { ...candidate, state } : candidate
  )
}

function dropEntry(input: SendDispositionInput): StructuredAgentSessionOutboxEntry[] {
  return input.entries.filter(
    (candidate) => candidate.clientMessageId !== input.entry.clientMessageId
  )
}

/**
 * The user force-retried a host-confirmed `unknown` and got the same submission
 * back. That is now the only answer such a retry can get: `unknown` means the
 * host cannot tell whether the provider has the message, and no reason it
 * records ever makes a second delivery safe. Parking the entry would offer a
 * Retry that does nothing in front of a queue nothing can drain, so it leaves
 * the outbox. Nothing is lost from the conversation: the durable submission row
 * already renders the message.
 *
 * A `rejected` submission takes the other path — the message provably did not
 * happen, so Retry rotates the id and sends it as a genuinely new message.
 */
function refusedRedelivery(
  entry: StructuredAgentSessionOutboxEntry,
  submission: AgentSessionSendResult['submission']
): boolean {
  return (
    entry.retryAfterUnknownSubmittedAt !== null &&
    submission.dispatchState === 'unknown' &&
    submission.submittedAt === entry.retryAfterUnknownSubmittedAt
  )
}

/**
 * What to put on screen for a rejection.
 *
 * A content rejection's reason is the provider explaining itself, so it is shown
 * verbatim — "Claude does not support the image type .bmp" is the whole answer and
 * a generic string would throw it away. A transport rejection's reason is an
 * internal marker; printing it put `provider_write_failed: broken pipe` in front of
 * users, which names nothing they can act on. That case gets copy that says what
 * happened and that the message is safe to send again — which it is, because the
 * frame provably never left, so a resend cannot duplicate.
 *
 * The null default claims no cause, because at that point we know none: all it
 * asserts is the one thing every rejection shares.
 *
 * Exported because a client without an outbox needs the same copy: the rule about
 * which reasons a person may read is a property of the reason, not of the queue.
 */
export function structuredAgentSessionRejectionNotice(reason: string | null): string {
  if (reason === null) {
    return 'Message was not sent.'
  }
  if (dispatchRejectionWasTransportWriteFailure(reason)) {
    return "Couldn't reach the agent. Your message was not sent — Retry to send it again."
  }
  // Any other reason we minted is an internal cause with no user-facing meaning;
  // only a provider's own explanation is worth reading verbatim.
  return dispatchRejectionReasonIsInternal(reason)
    ? 'Orca could not send your message — Retry to send it again.'
    : reason
}

/** The message provably did not happen: it parks with its reason, and Retry sends it under a new id. */
function rejectedSubmissionDisposition(
  entries: StructuredAgentSessionOutboxEntry[],
  clientMessageId: string,
  reason: string | null
): StructuredAgentSessionSendDisposition {
  return {
    entries,
    error: structuredAgentSessionRejectionNotice(reason),
    blockedClientMessageId: clientMessageId,
    retryWithFreshClientMessageId: clientMessageId
  }
}

/** A rejection the user is told about; a cancel is their own withdrawal and drops silently. */
function reportsRejection(submission: AgentJournalSubmission): boolean {
  return (
    submission.dispatchState === 'rejected' && submission.reason !== DISPATCH_REJECTED_CANCELLED
  )
}

/**
 * The journal rejected a send after its dispatch answered `pending`, or while the pane was away.
 * That is the same fact as a rejected send result, so it gets the same disposition. Every such
 * entry is requeued so none is skipped as in flight, and the queue stops on the first. Null while
 * another answer already holds the queue, or when nothing was rejected.
 */
export function disposeStructuredAgentSessionLateRejection(input: {
  entries: readonly StructuredAgentSessionOutboxEntry[]
  submissions: readonly AgentJournalSubmission[]
  blockedClientMessageId: string | null
}): StructuredAgentSessionSendDisposition | null {
  if (input.blockedClientMessageId !== null) {
    return null
  }
  const rejected = new Map(
    input.submissions
      .filter(reportsRejection)
      .map((submission) => [submission.clientMessageId, submission.reason])
  )
  const head = input.entries.find((entry) => rejected.has(entry.clientMessageId))
  if (!head) {
    return null
  }
  const entries = input.entries.map((entry) =>
    rejected.has(entry.clientMessageId) && entry.state !== 'queued'
      ? { ...entry, state: 'queued' as const }
      : entry
  )
  return rejectedSubmissionDisposition(
    entries,
    head.clientMessageId,
    rejected.get(head.clientMessageId) ?? null
  )
}

/** What one journal update does to the outbox; the hook applies it and owns the refs and storage. */
export type StructuredAgentSessionJournalFold = {
  entries: StructuredAgentSessionOutboxEntry[]
  /** The journal answered the send in flight, so its promise must not apply. */
  answeredInFlight: boolean
  /** The host now owns the blocked or an unconfirmed entry, so the banner no longer applies. */
  clearsError: boolean
  /** Always the next value, never "unchanged". */
  blockedClientMessageId: string | null
  /** Applied last: it names the new blocked entry, its error and the id Retry rotates. */
  lateRejection: StructuredAgentSessionSendDisposition | null
}

export function foldStructuredAgentSessionJournal(input: {
  entries: readonly StructuredAgentSessionOutboxEntry[]
  submissions: readonly AgentJournalSubmission[]
  blockedClientMessageId: string | null
  inFlightClientMessageId: string | null
}): StructuredAgentSessionJournalFold {
  const hostOwns = new Set(
    input.submissions
      .filter(
        (submission) =>
          submission.dispatchState === 'pending' || submission.dispatchState === 'accepted'
      )
      .map((submission) => submission.clientMessageId)
  )
  const unblocks =
    input.blockedClientMessageId !== null && hostOwns.has(input.blockedClientMessageId)
  const blockedClientMessageId = unblocks ? null : input.blockedClientMessageId
  const reconciled = reconcileStructuredAgentSessionOutbox(input.entries, input.submissions)
  const lateRejection = disposeStructuredAgentSessionLateRejection({
    entries: reconciled,
    submissions: input.submissions,
    blockedClientMessageId
  })
  const entries = lateRejection?.entries ?? reconciled
  const inFlight = input.inFlightClientMessageId
  return {
    entries,
    // A late rejection that requeued the entry in flight answered it too.
    answeredInFlight:
      inFlight !== null &&
      (hostOwns.has(inFlight) ||
        entries.some(
          (entry, index) => entry.clientMessageId === inFlight && entry !== reconciled[index]
        )),
    clearsError:
      unblocks ||
      input.entries.some(
        (entry) => entry.state === 'unconfirmed' && hostOwns.has(entry.clientMessageId)
      ),
    blockedClientMessageId,
    lateRejection
  }
}

/**
 * For a client with no outbox: which awaited sends the journal has settled, and the notice for each
 * one it rejected, so a late rejection reads exactly like an immediate one.
 */
export function settleAwaitedStructuredAgentSessionSends(
  awaited: ReadonlySet<string>,
  submissions: readonly AgentJournalSubmission[]
): { settled: string[]; notices: string[] } {
  const settled: string[] = []
  const notices: string[] = []
  for (const submission of submissions) {
    if (
      !awaited.has(submission.clientMessageId) ||
      (submission.dispatchState !== 'accepted' && submission.dispatchState !== 'rejected')
    ) {
      continue
    }
    settled.push(submission.clientMessageId)
    if (reportsRejection(submission)) {
      notices.push(structuredAgentSessionRejectionNotice(submission.reason))
    }
  }
  return { settled, notices }
}

export function disposeStructuredAgentSessionSendResult(
  input: SendDispositionInput & {
    result: AgentSessionMutationResult<AgentSessionSendResult>
    createOperationId: () => string
  }
): StructuredAgentSessionSendDisposition {
  const result = input.result
  if (!result.ok) {
    const refusedIndex = input.entries.findIndex(
      (candidate) => candidate.clientMessageId === input.entry.clientMessageId
    )
    const entries = input.entries.map((candidate) =>
      candidate.clientMessageId === input.entry.clientMessageId
        ? requeueStructuredAgentSessionSendRefusal(
            candidate,
            result.refusal.code,
            input.createOperationId,
            input.entry.lastAttemptAt !== null
          )
        : candidate
    )
    return {
      entries,
      error: result.refusal.message,
      // Read back by index rather than from the input: a refusal can rotate the id, and the
      // refused entry is not always the head now that an admitted one no longer holds the queue.
      blockedClientMessageId: entries[refusedIndex]?.clientMessageId ?? null,
      retryWithFreshClientMessageId: null
    }
  }
  const submission = result.value.submission
  if (refusedRedelivery(input.entry, submission)) {
    return {
      entries: dropEntry(input),
      error: 'Message delivery is unconfirmed and Orca will not send it again',
      blockedClientMessageId: input.blockedClientMessageId,
      retryWithFreshClientMessageId: null
    }
  }
  if (submission.dispatchState === 'accepted') {
    return {
      entries: dropEntry(input),
      error: null,
      blockedClientMessageId: input.blockedClientMessageId,
      retryWithFreshClientMessageId: null
    }
  }
  if (submission.dispatchState === 'rejected') {
    return rejectedSubmissionDisposition(
      replaceEntryState(input, 'queued'),
      input.entry.clientMessageId,
      submission.reason
    )
  }
  if (submission.dispatchState === 'unknown' && submission.recovered) {
    return {
      entries: input.entries.map((candidate) =>
        candidate.clientMessageId === input.entry.clientMessageId
          ? { ...candidate, state: 'unconfirmed', retryAfterUnknownSubmittedAt: -1 }
          : candidate
      ),
      error: null,
      blockedClientMessageId: input.blockedClientMessageId,
      retryWithFreshClientMessageId: null
    }
  }
  // `pending` is the host saying the message was written and is awaiting the
  // provider's acknowledgement, which cannot arrive until the turn ahead of it
  // ends. That is not doubt, and keeping order is no longer the reason to hold
  // the entry -- the host fixed the order when it wrote the row. It stays
  // because a `pending` can still settle `rejected` or `unknown`, and only the
  // entry carries the retry state that answer needs.
  return {
    entries: replaceEntryState(
      input,
      submission.dispatchState === 'unknown' ? 'unconfirmed' : 'dispatching'
    ),
    error: null,
    blockedClientMessageId: input.blockedClientMessageId,
    retryWithFreshClientMessageId: null
  }
}

export function disposeStructuredAgentSessionSendFailure(
  input: SendDispositionInput & {
    cause: unknown
    isDeliveryUnknown: (error: unknown) => boolean
  }
): StructuredAgentSessionSendDisposition {
  const failure = classifyStructuredAgentSessionSendFailure(input.cause, input.isDeliveryUnknown)
  const deliveryUnknown = failure === 'delivery-unknown'
  return {
    entries: replaceEntryState(input, deliveryUnknown ? 'unconfirmed' : 'queued'),
    error: deliveryUnknown ? 'Message delivery is unconfirmed' : String(input.cause),
    blockedClientMessageId: deliveryUnknown
      ? input.blockedClientMessageId
      : input.entry.clientMessageId,
    retryWithFreshClientMessageId: null
  }
}
