/**
 * Resolve target agent from request context.
 *
 * resolveAgentStrict is the one to use. resolveAgent falls back to whichever
 * agent the server is currently focused on when the request does not name one,
 * which is a guess: with two clients open on two different agents it is
 * sometimes the other client's agent, so a read can describe the wrong agent
 * and a write can land on it.
 *
 * Only the plugin route still uses the guessing version, because agentId is
 * optional in the plugin contract and making it required would change that
 * contract. tests/focus-fallback-agent-resolution.test.ts pins that list at
 * exactly one entry: new routes take an explicit agentId and use
 * resolveAgentStrict.
 */

/**
 * 焦点回落版：显式 ID 找不到时抛错；无 ID 时用焦点 agent。
 * 新代码别用，见上方说明；只有 plugins 路由是合法消费者。
 */
export function resolveAgent(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (explicit) {
    const found = engine.getAgent(explicit);
    if (!found) throw new AgentNotFoundError(explicit);
    return found;
  }
  // 无显式 ID：使用焦点 agent（UI 请求的默认行为）
  const agent = engine.getAgent(engine.currentAgentId);
  if (!agent) throw new AgentNotFoundError(engine.currentAgentId);
  return agent;
}

/** 写操作用：强制要求显式 agentId，不做 fallback */
export function resolveAgentStrict(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (!explicit) {
    throw new AgentNotFoundError("(missing agentId)");
  }
  const found = engine.getAgent(explicit);
  if (!found) throw new AgentNotFoundError(explicit);
  return found;
}

export class AgentNotFoundError extends Error {
  declare status: number;
  declare agentId: any;
  constructor(id) {
    super(`agent "${id}" not found`);
    this.name = "AgentNotFoundError";
    this.status = 404;
    this.agentId = id;
  }
}
