import { useCallback } from 'react'
import {
  retryStructuredAgentSessionLaunch,
  useStructuredAgentSessionLaunchFailureReason,
  useStructuredAgentSessionLaunchLifecycle
} from '@/lib/structured-agent-session-launch'

export function useNativeChatProvisionalLaunch(
  worktreeId: string | null | undefined,
  sessionId: string
) {
  const lifecycle = useStructuredAgentSessionLaunchLifecycle(worktreeId ?? '', sessionId)
  const failureReason = useStructuredAgentSessionLaunchFailureReason(worktreeId ?? '', sessionId)
  const retry = useCallback(() => {
    if (worktreeId) {
      retryStructuredAgentSessionLaunch(worktreeId, sessionId)
    }
  }, [sessionId, worktreeId])
  return {
    lifecycle,
    failureReason,
    retry,
    transportEnabled: lifecycle === null || lifecycle === 'published'
  }
}
