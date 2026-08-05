import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

/**
 * 切换助手失败时，路由必须把抛错点已经挂好的 code / status 原样交给前端。
 * 前端只有拿到 code 才能给出"这个助手的模型没了，去设置里换一个"这类可行动的提示；
 * 一旦被压成裸 500，用户看到的只有一段翻译不了的英文。
 */
describe("agents route: /agents/switch error surfacing", () => {
  async function switchWith(switchAgent) {
    const { createAgentsRoute } = await import("../server/routes/agents.ts");
    const app = new Hono();
    const engine = {
      currentAgentId: "target",
      config: { cwd_history: [] },
      switchAgent,
      updateConfig: vi.fn().mockResolvedValue(undefined),
      getAgent: vi.fn(() => ({ agentName: "Target" })),
      emitEvent: vi.fn(),
    };
    app.route("/api", createAgentsRoute(engine));
    const res = await app.request("/api/agents/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "target" }),
    });
    return { res, data: await res.json(), engine };
  }

  it("passes through the status and code carried by the thrown error", async () => {
    const err: any = new Error("Agent target has no available model: openai/gpt-9");
    err.code = "agent_model_not_available";
    err.status = 409;

    const { res, data } = await switchWith(vi.fn().mockRejectedValue(err));

    expect(res.status).toBe(409);
    expect(data).toEqual({
      error: "Agent target has no available model: openai/gpt-9",
      code: "agent_model_not_available",
    });
  });

  it("still answers 500 without a code when the error carries none", async () => {
    const { res, data } = await switchWith(vi.fn().mockRejectedValue(new Error("boom")));

    expect(res.status).toBe(500);
    expect(data).toEqual({ error: "boom" });
    expect(data.code).toBeUndefined();
  });
});
