/**
 * Resolve target agent from request context.
 * Priority: query.agentId > params.agentId > engine.currentAgentId
 * Falls back to focus agent for backward compatibility.
 */
export function resolveAgent(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (explicit) {
    const found = engine.getAgent(explicit);
    if (!found) console.warn(`[resolveAgent] agentId "${explicit}" not found, falling back to focus agent`);
    return found || engine.agent;
  }
  return engine.getAgent(engine.currentAgentId) || engine.agent;
}
