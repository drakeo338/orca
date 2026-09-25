import { useCallback, useEffect, useRef } from 'react'
import type { AgentJournalSubmission } from '../../../src/shared/agent-session-journal-types'
import { settleAwaitedStructuredAgentSessionSends } from '../../../src/shared/structured-agent-session-send-disposition'
import { clearMobileStructuredSettledSendOperations } from './mobile-structured-send-operation-journal'

/** Settles sends from the stream: releases their ids, and reports a send the host answered
 *  `pending` and later rejected, with the notice an immediate rejection gets. */
export function useMobileStructuredSendOperationReconciliation(
  submissions: readonly AgentJournalSubmission[],
  onSendError: (message: string) => void
): (clientMessageId: string) => void {
  const awaitedRef = useRef(new Set<string>())
  const submissionsRef = useRef(submissions)
  const onSendErrorRef = useRef(onSendError)
  useEffect(() => {
    onSendErrorRef.current = onSendError
  }, [onSendError])

  const reportSettled = useCallback((current: readonly AgentJournalSubmission[]) => {
    const { settled, notices } = settleAwaitedStructuredAgentSessionSends(
      awaitedRef.current,
      current
    )
    for (const clientMessageId of settled) {
      awaitedRef.current.delete(clientMessageId)
    }
    for (const notice of notices) {
      onSendErrorRef.current(notice)
    }
  }, [])

  useEffect(() => {
    submissionsRef.current = submissions
    reportSettled(submissions)
    void clearMobileStructuredSettledSendOperations({ submissions }).catch(() => undefined)
  }, [reportSettled, submissions])

  // Registers a send to await; the stream can settle it before its RPC answer arrives.
  return useCallback(
    (clientMessageId: string) => {
      awaitedRef.current.add(clientMessageId)
      reportSettled(submissionsRef.current)
    },
    [reportSettled]
  )
}
