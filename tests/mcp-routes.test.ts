/**
 * MCP is a first-class core module, so its HTTP surface lives at /api/mcp.
 * The historical /api/plugins/mcp paths stay mounted as an alias: installed
 * clients and any saved OAuth redirect URIs still point at them.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createMcpRoute } from "../server/routes/mcp.ts";
import { createPluginProxyRoute } from "../server/routes/plugins.ts";

function createApp(mcp) {
  const app = new Hono();
  app.route("/api", createMcpRoute({ mcp } as any));
  return app;
}

function fakeMcp(overrides: any = {}) {
  return {
    getState: vi.fn(() => ({ enabled: true, connectors: [], servers: [] })),
    getAgentConfig: vi.fn(async () => ({})),
    setEnabled: vi.fn(async () => ({ enabled: true, connectors: [] })),
    _markCapabilitySnapshotsStale: vi.fn(async () => null),
    completeOAuth: vi.fn(async () => ({ status: "done" })),
    getOAuthStatus: vi.fn(() => ({ status: "pending" })),
    startOAuth: vi.fn(async () => ({ sessionId: "s1", url: "https://auth.example.com/authorize" })),
    ...overrides,
  };
}

describe("MCP first-class routes", () => {
  it("serves runtime state at /api/mcp/state", async () => {
    const mcp = fakeMcp();
    const res = await createApp(mcp).request("/api/mcp/state");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, connectors: [] });
  });

  it("serves the same state through the legacy /api/plugins/mcp alias", async () => {
    const mcp = fakeMcp();
    const app = createApp(mcp);

    const [primary, alias] = await Promise.all([
      app.request("/api/mcp/state"),
      app.request("/api/plugins/mcp/state"),
    ]);

    expect(alias.status).toBe(200);
    expect(await alias.json()).toEqual(await primary.json());
  });

  it("applies a global enable through /api/mcp/settings/enabled", async () => {
    const mcp = fakeMcp();
    const res = await createApp(mcp).request("/api/mcp/settings/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(200);
    expect(mcp.setEnabled).toHaveBeenCalledWith(true);
    expect(mcp._markCapabilitySnapshotsStale).toHaveBeenCalledWith({ reason: "mcp.global.enabled" });
  });

  it("accepts the OAuth callback on both the first-class and legacy paths", async () => {
    const mcp = fakeMcp();
    const app = createApp(mcp);

    for (const routePath of ["/api/mcp/oauth/callback", "/api/plugins/mcp/oauth/callback"]) {
      const res = await app.request(`${routePath}?state=st_1&code=code_1`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Connector connected");
    }

    expect(mcp.completeOAuth).toHaveBeenCalledTimes(2);
  });

  it("hands the connector the first-class callback URL when starting OAuth", async () => {
    const mcp = fakeMcp();
    const res = await createApp(mcp).request("/api/mcp/connectors/github/oauth/start", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(mcp.startOAuth).toHaveBeenCalledWith(
      "github",
      expect.stringContaining("/api/mcp/oauth/callback"),
    );
  });

  it("keeps the historical servers aliases working", async () => {
    const mcp = fakeMcp();
    const app = createApp(mcp);

    const res = await app.request("/api/mcp/servers/github/oauth/start", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mcp.startOAuth).toHaveBeenCalled();
  });

  it("wins over the generic plugin proxy for the legacy alias path", async () => {
    // open-root mounts createMcpRoute ahead of the plugin routes. If that order
    // ever flips, /api/plugins/mcp/* falls through to a plugin lookup that no
    // longer has an "mcp" entry, and every legacy client 404s.
    const mcp = fakeMcp();
    const app = new Hono();
    app.route("/api", createMcpRoute({ mcp } as any));
    app.route("/api", createPluginProxyRoute(new Map()));

    const res = await app.request("/api/plugins/mcp/state");

    expect(res.status).toBe(200);
    expect(mcp.getState).toHaveBeenCalled();
  });

  it("reports 503 while the manager is not initialized", async () => {
    const app = new Hono();
    app.route("/api", createMcpRoute({ mcp: null } as any));

    const res = await app.request("/api/mcp/state");
    expect(res.status).toBe(503);
  });
});
