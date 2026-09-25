import { useCallback, useEffect, useRef, useState } from 'react'
import { STRUCTURED_LAUNCH_SEED_OPTION_IDS } from '../../../../shared/native-chat-session-option-defaults'

export type StructuredOptionSendOutcome = 'accepted' | 'refused' | 'superseded'

type HeldPicks = { identity: string; values: Readonly<Record<string, string>> }

const NO_HELD_PICKS: Readonly<Record<string, string>> = {}

function heldFor(picks: HeldPicks, identity: string): Readonly<Record<string, string>> {
  return picks.identity === identity ? picks.values : NO_HELD_PICKS
}

/**
 * Picks made before the session can take them (the launch is provisional, or no
 * fence is attached yet), as encoded values keyed by option id. They send nothing
 * until `deliverable`, then flush one key at a time through `send`; only the
 * host's acceptance persists a pick. Memory only, so a closed tab drops them.
 */
export function useHeldStructuredOptionPicks(args: {
  identity: string
  deliverable: boolean
  pending: boolean
  send: (id: string, encoded: string) => Promise<StructuredOptionSendOutcome>
}) {
  const { deliverable, identity, pending, send } = args
  const [picks, setPicks] = useState<HeldPicks>(() => ({ identity, values: NO_HELD_PICKS }))
  const picksRef = useRef(picks)
  const updatePicks = useCallback(
    (
      forIdentity: string,
      update: (values: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
    ) => {
      const next = { identity: forIdentity, values: update(heldFor(picksRef.current, forIdentity)) }
      picksRef.current = next
      setPicks(next)
    },
    []
  )
  const held = heldFor(picks, identity)
  const currentHeld = useCallback(() => heldFor(picksRef.current, identity), [identity])
  const hold = useCallback(
    (id: string, encoded: string) =>
      // A model pick drops values held under the model it replaces.
      updatePicks(identity, (values) =>
        id === 'model' ? { model: encoded } : { ...values, [id]: encoded }
      ),
    [identity, updatePicks]
  )

  const flushing = useRef(false)
  const [resendAttempt, setResendAttempt] = useState(0)
  useEffect(() => {
    if (!deliverable || pending || flushing.current) {
      return
    }
    // Model first, so a held effort lands under the model it was picked against.
    const id = STRUCTURED_LAUNCH_SEED_OPTION_IDS.find((key) => held[key] !== undefined)
    const encoded = id ? held[id] : undefined
    if (!id || encoded === undefined) {
      return
    }
    flushing.current = true
    void send(id, encoded).then((outcome) => {
      flushing.current = false
      if (outcome === 'superseded') {
        // The fence moved under the send; it stays held for the new one.
        setResendAttempt((attempt) => attempt + 1)
        return
      }
      updatePicks(identity, (values) => {
        if (values[id] !== encoded) {
          return values
        }
        const { [id]: _settled, ...rest } = values
        return rest
      })
    })
  }, [deliverable, held, identity, pending, resendAttempt, send, updatePicks])

  return { held, currentHeld, hold }
}
