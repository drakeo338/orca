// Sessions whose pane holds option picks the host has not settled yet. A launch prompt is
// sent outside the pane's outbox, so it waits here: a pick made while the chat launched
// must reach the host before the first turn it is shown against.

const holdingSessions = new Set<string>()
const listeners = new Set<() => void>()

export function setStructuredAgentSessionOptionPicksHeld(sessionId: string, held: boolean): void {
  if (held === holdingSessions.has(sessionId)) {
    return
  }
  if (held) {
    holdingSessions.add(sessionId)
  } else {
    holdingSessions.delete(sessionId)
  }
  for (const listener of listeners) {
    listener()
  }
}

/** Resolves once no pick is held for the session; the pane releases its hold on unmount. */
export function whenStructuredAgentSessionOptionPicksSettled(sessionId: string): Promise<void> {
  if (!holdingSessions.has(sessionId)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const check = (): void => {
      if (!holdingSessions.has(sessionId)) {
        listeners.delete(check)
        resolve()
      }
    }
    listeners.add(check)
  })
}

export function resetStructuredAgentSessionOptionPicksHeldForTests(): void {
  holdingSessions.clear()
  listeners.clear()
}
