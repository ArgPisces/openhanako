import { Hono } from "hono";

/**
 * HTTP surface for the MCP connector manager.
 *
 * The sub-app is mounted twice: at `/mcp` (first-class) and at `/plugins/mcp`
 * (the path this API lived on while MCP shipped as a bundled plugin). The alias
 * keeps already-installed clients and previously issued OAuth redirect URIs
 * working; both mounts serve the identical handlers.
 */
export function createMcpRoute(engine) {
  const sub = new Hono();
  const runtime = () => engine?.mcp;

  async function currentState(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    const agentId = c.req.query("agentId") || c.get("agentId") || null;
    const config = await rt.getAgentConfig(agentId);
    return c.json(rt.getState(config));
  }

  async function markCapabilitySnapshotsStale(payload: Record<string, unknown>) {
    const rt = runtime();
    await rt?._markCapabilitySnapshotsStale?.(payload);
  }

  // The callback always points at the first-class path. The legacy path stays
  // routable for redirect URIs issued before the move.
  function redirectUriForRequest(c) {
    const url = new URL(c.req.url);
    return new URL("/api/mcp/oauth/callback", url.origin).href;
  }

  function htmlPage(title, body) {
    return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family:system-ui,-apple-system,sans-serif;padding:32px;line-height:1.5;color:#333;background:#faf8f2"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>`;
  }

  sub.get("/state", currentState);

  async function setGlobalEnabled(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    const { enabled } = await c.req.json();
    try {
      await rt.setEnabled(enabled === true);
      await markCapabilitySnapshotsStale({ reason: "mcp.global.enabled" });
      return currentState(c);
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  sub.put("/settings/enabled", setGlobalEnabled);
  sub.put("/enabled", setGlobalEnabled);

  async function addConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const connector = rt.addConnector(await c.req.json());
      await markCapabilitySnapshotsStale({ reason: "mcp.connector.add", connectorId: connector.id });
      const state = rt.getState();
      const publicConnector = state.connectors.find((item) => item.id === connector.id) || connector;
      return c.json({ connector: publicConnector, server: publicConnector, state });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function updateConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const connector = await rt.updateConnector(c.req.param("id"), await c.req.json());
      await markCapabilitySnapshotsStale({ reason: "mcp.connector.update", connectorId: connector.id });
      const state = rt.getState();
      const publicConnector = state.connectors.find((item) => item.id === connector.id) || connector;
      return c.json({ connector: publicConnector, server: publicConnector, state });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function removeConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      await rt.removeConnector(c.req.param("id"));
      await markCapabilitySnapshotsStale({ reason: "mcp.connector.remove", connectorId: c.req.param("id") });
      return c.json(rt.getState());
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function connectorAction(c, action) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const id = c.req.param("id");
      if (action === "start") await rt.startConnector(id);
      else if (action === "stop") {
        await rt.stopConnector(id);
        await markCapabilitySnapshotsStale({ reason: "mcp.connector.stop", connectorId: id });
      }
      else if (action === "refresh-tools") {
        const tools = await rt.refreshTools(id);
        return c.json({ tools, state: rt.getState() });
      }
      return c.json(rt.getState());
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function updateAgentConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const patch = await c.req.json();
      const config = await rt.updateAgentMcpConnector(
        c.req.param("agentId"),
        c.req.param("id"),
        patch,
      );
      const reason = patch?.tools && typeof patch.tools === "object"
        ? "mcp.agent.tool.enable"
        : "mcp.agent.connector.enable";
      await markCapabilitySnapshotsStale({
        reason,
        agentId: c.req.param("agentId"),
        connectorId: c.req.param("id"),
      });
      return c.json({ config });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  sub.post("/connectors", addConnector);
  sub.post("/servers", addConnector);
  sub.put("/connectors/:id", updateConnector);
  sub.put("/servers/:id", updateConnector);
  sub.delete("/connectors/:id", removeConnector);
  sub.delete("/servers/:id", removeConnector);

  sub.post("/connectors/:id/start", (c) => connectorAction(c, "start"));
  sub.post("/servers/:id/start", (c) => connectorAction(c, "start"));
  sub.post("/connectors/:id/stop", (c) => connectorAction(c, "stop"));
  sub.post("/servers/:id/stop", (c) => connectorAction(c, "stop"));
  sub.post("/connectors/:id/refresh-tools", (c) => connectorAction(c, "refresh-tools"));
  sub.post("/servers/:id/refresh-tools", (c) => connectorAction(c, "refresh-tools"));

  sub.put("/agents/:agentId/connectors/:id", updateAgentConnector);
  sub.put("/agents/:agentId/servers/:id", updateAgentConnector);

  async function startOAuth(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      return c.json(await rt.startOAuth(c.req.param("id"), redirectUriForRequest(c)));
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function logoutOAuth(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const connector = await rt.logoutOAuth(c.req.param("id"));
      const state = rt.getState();
      const publicConnector = state.connectors.find((item) => item.id === connector.id) || connector;
      return c.json({ connector: publicConnector, state });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  sub.post("/connectors/:id/oauth/start", startOAuth);
  sub.post("/servers/:id/oauth/start", startOAuth);
  sub.post("/connectors/:id/oauth/logout", logoutOAuth);
  sub.post("/servers/:id/oauth/logout", logoutOAuth);

  sub.get("/oauth/callback", async (c) => {
    const rt = runtime();
    if (!rt) return c.html(htmlPage("MCP Connector OAuth", "MCP runtime is not initialized."), 503);
    const url = new URL(c.req.url);
    try {
      await rt.completeOAuth({
        state: url.searchParams.get("state") || "",
        code: url.searchParams.get("code") || "",
        error: url.searchParams.get("error") || "",
      });
      return c.html(htmlPage("Connector connected", "You can close this window and return to Hana."));
    } catch (err) {
      return c.html(htmlPage("Connector OAuth failed", err.message), 400);
    }
  });

  sub.get("/oauth/poll/:sessionId", (c) => {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    return c.json(rt.getOAuthStatus(c.req.param("sessionId")));
  });

  const app = new Hono();
  app.route("/mcp", sub);
  // Legacy alias. It is registered here, ahead of the generic
  // /plugins/:pluginId/* proxy, so these paths never fall through to a plugin
  // lookup that would now miss.
  app.route("/plugins/mcp", sub);
  return app;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
