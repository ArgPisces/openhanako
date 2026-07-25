import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

/**
 * The config route family used to expose agent-owned resources on paths that
 * carried no agent identity, resolving the target through the server's focus
 * pointer. Those paths are gone; the per-agent front door under
 * /api/agents/:id/... is the only way in. These tests lock the removal so the
 * implicit paths cannot quietly come back.
 */

function makeEngine() {
  const agent = {
    id: "hana",
    agentDir: "/tmp/does-not-exist/agents/hana",
    systemPrompt: "prompt body",
    enabledSkills: [],
  };
  return {
    config: {},
    configPath: "/tmp/does-not-exist/config.yaml",
    currentAgentId: "hana",
    agentsDir: "/tmp/does-not-exist/agents",
    getAgent: vi.fn((id) => (id === "hana" ? agent : null)),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
}

async function mountConfigRoute() {
  const { createConfigRoute } = await import("../server/routes/config.ts");
  const app = new Hono();
  app.route("/api", createConfigRoute(makeEngine()));
  return app;
}

/** A handler that answered would reply with JSON; an unregistered path falls through. */
async function expectUnregistered(res: Response) {
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type") || "").not.toContain("application/json");
}

describe("config route family: no agent-implicit paths", () => {
  it("does not serve the agent system prompt without an agent identity", async () => {
    const app = await mountConfigRoute();
    await expectUnregistered(await app.request("/api/system-prompt"));
  });

  it("does not read pinned memory without an agent identity", async () => {
    const app = await mountConfigRoute();
    await expectUnregistered(await app.request("/api/pinned"));
  });

  it("does not write pinned memory without an agent identity", async () => {
    const app = await mountConfigRoute();
    await expectUnregistered(await app.request("/api/pinned", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pins: ["something"] }),
    }));
  });
});
