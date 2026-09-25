// The options read surface: what a session reports about itself, and the
// host's stored model catalog behind the picker.
//
// `agentSession.options` serializes on the session because it asks the live
// provider what is selected. `agentSession.modelCatalog` deliberately does
// neither — answering from the host store is what lets a picker render while
// an attach is still running. It is additive: an older host answers
// `method_not_found` (or `forbidden` through the mobile allowlist gate), and
// the client keeps its static seed.

import { defineMethod } from '../core'
import { requireStructuredHost as requireHost } from './structured-agent-session-gate'
import { ModelCatalogParams, OptionsParams } from './structured-agent-session-schemas'

export const STRUCTURED_AGENT_SESSION_OPTIONS_READ_METHODS = [
  defineMethod({
    name: 'agentSession.options',
    params: OptionsParams,
    handler: async (params, ctx) => requireHost(ctx).readOptions(params.sessionId)
  }),
  defineMethod({
    name: 'agentSession.modelCatalog',
    params: ModelCatalogParams,
    handler: async (params, ctx) =>
      (await requireHost(ctx).deps.modelCatalog?.read(params)) ?? { origin: 'unknown' as const }
  })
]
