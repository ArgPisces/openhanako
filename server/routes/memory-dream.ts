import { Hono } from "hono";
import { denyWithoutScope } from "../http/capability-guard.ts";
import { AgentNotFoundError, resolveAgentStrict } from "../utils/resolve-agent.ts";

function unavailable(c: any, message = "Memory Dream is unavailable for this agent") {
  return c.json({ error: message }, 503);
}

export function createMemoryDreamRoute(engine: any) {
  const route = new Hono();

  route.get("/memories/dream/status", async (c) => {
    try {
      const agent = resolveAgentStrict(engine, c);
      const ticker = agent.memoryTicker;
      if (!ticker?.getDreamStatus) return unavailable(c);
      return c.json({ agentId: agent.id, ...ticker.getDreamStatus() });
    } catch (err: any) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err?.message || String(err) }, 500);
    }
  });

  route.post("/memories/dream/runs", async (c) => {
    try {
      const denied = denyWithoutScope(c, "settings.write");
      if (denied) return denied;
      const agent = resolveAgentStrict(engine, c);
      const ticker = agent.memoryTicker;
      if (!ticker?.startDream) return unavailable(c);
      if (agent.memoryMasterEnabled === false) {
        return c.json({ error: "Memory is disabled for this agent" }, 409);
      }
      const started = ticker.startDream({ trigger: "manual" });
      return c.json({ agentId: agent.id, ...started }, 202);
    } catch (err: any) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      if (err?.code === "DREAM_ALREADY_RUNNING" || err?.code === "DREAM_MEMORY_BUSY") {
        return c.json({ error: err.message }, 409);
      }
      return c.json({ error: err?.message || String(err) }, 500);
    }
  });

  route.post("/memories/dream/revisions/:revisionId/restore", async (c) => {
    try {
      const denied = denyWithoutScope(c, "settings.write");
      if (denied) return denied;
      const agent = resolveAgentStrict(engine, c);
      const ticker = agent.memoryTicker;
      if (!ticker?.restoreDreamRevision) return unavailable(c);
      const result = await ticker.restoreDreamRevision(c.req.param("revisionId"));
      return c.json({ agentId: agent.id, ok: true, ...result });
    } catch (err: any) {
      if (err instanceof AgentNotFoundError) return c.json({ error: err.message }, 404);
      if (err?.code === "DREAM_ALREADY_RUNNING" || err?.code === "DREAM_MEMORY_BUSY") {
        return c.json({ error: err.message }, 409);
      }
      if (/not found/i.test(err?.message || "")) return c.json({ error: err.message }, 404);
      return c.json({ error: err?.message || String(err) }, 500);
    }
  });

  return route;
}
