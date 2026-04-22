import { describe, it, expect, beforeEach, vi } from "vitest";
import { bridgeCommands } from "../../core/slash-commands/bridge-commands.js";

function makeCtx(overrides = {}) {
  return {
    sessionRef: { kind: "bridge", agentId: "a1", sessionKey: "tg_dm_x@a1" },
    sessionOps: {
      isStreaming: vi.fn(() => true),
      abort: vi.fn(async () => true),
      rotate: vi.fn(async () => ({ status: "rotated" })),
      delete: vi.fn(async () => ({ status: "deleted" })),
      compact: vi.fn(async () => {}),
    },
    reply: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("/stop", () => {
  const stop = bridgeCommands.find(c => c.name === "stop");
  it("declares owner permission and abort alias", () => {
    expect(stop.permission).toBe("owner");
    expect(stop.aliases).toContain("abort");
  });
  it("calls sessionOps.abort and returns silent when streaming", async () => {
    const ctx = makeCtx();
    const r = await stop.handler(ctx);
    expect(ctx.sessionOps.abort).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r?.silent).toBe(true);
  });
  it("returns reply when nothing to abort", async () => {
    const ctx = makeCtx({ sessionOps: { isStreaming: () => false, abort: vi.fn(async () => false) } });
    const r = await stop.handler(ctx);
    expect(r.reply).toMatch(/当前无活动/);
  });
  it("returns reply when abort reports failure even while streaming was observed", async () => {
    // 防 regression：TOCTOU 假阳性时 abort=false 仍须走 fallback reply
    const ctx = makeCtx({ sessionOps: { isStreaming: () => true, abort: vi.fn(async () => false) } });
    const r = await stop.handler(ctx);
    expect(r.reply).toMatch(/当前无活动/);
  });
});

describe("/new", () => {
  const cmd = bridgeCommands.find(c => c.name === "new");
  it("calls rotate and reports rotated status", async () => {
    const ctx = makeCtx();
    const r = await cmd.handler(ctx);
    expect(ctx.sessionOps.rotate).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r.reply).toMatch(/已开启新会话.*归档/);
  });
  it("reports no-history status distinctly", async () => {
    const ctx = makeCtx({ sessionOps: { rotate: vi.fn(async () => ({ status: "no-history" })) } });
    const r = await cmd.handler(ctx);
    expect(r.reply).toMatch(/无历史/);
  });
  it("reports not-found status distinctly", async () => {
    const ctx = makeCtx({ sessionOps: { rotate: vi.fn(async () => ({ status: "not-found" })) } });
    const r = await cmd.handler(ctx);
    expect(r.reply).toMatch(/未找到/);
  });
});

describe("/reset", () => {
  const cmd = bridgeCommands.find(c => c.name === "reset");
  it("calls delete and reports deleted status", async () => {
    const ctx = makeCtx();
    const r = await cmd.handler(ctx);
    expect(ctx.sessionOps.delete).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r.reply).toMatch(/已重置/);
  });
  it("reports not-found status distinctly", async () => {
    const ctx = makeCtx({ sessionOps: { delete: vi.fn(async () => ({ status: "not-found" })) } });
    const r = await cmd.handler(ctx);
    expect(r.reply).toMatch(/未找到/);
  });
});

describe("/compact", () => {
  const cmd = bridgeCommands.find(c => c.name === "compact");
  it("calls compact and returns reply", async () => {
    const ctx = makeCtx();
    const r = await cmd.handler(ctx);
    expect(ctx.sessionOps.compact).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r.reply).toMatch(/已压缩/);
  });
  it("propagates compact exceptions (no silent catch)", async () => {
    const ctx = makeCtx({
      sessionOps: { compact: vi.fn(async () => { throw new Error("inject failed"); }) },
    });
    await expect(cmd.handler(ctx)).rejects.toThrow(/inject failed/);
  });
});
