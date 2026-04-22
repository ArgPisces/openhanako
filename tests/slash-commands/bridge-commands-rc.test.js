import { describe, it, expect, vi } from "vitest";
import { bridgeCommands } from "../../core/slash-commands/bridge-commands.js";
import { RcStateStore } from "../../core/slash-commands/rc-state.js";

function cmd(name) { return bridgeCommands.find(c => c.name === name); }

function makeEngine({ sessions = [], rcState } = {}) {
  return {
    rcState: rcState || new RcStateStore(),
    listSessions: vi.fn(async () => sessions),
    getAgent: vi.fn(() => ({ id: "a1", config: { models: { chat: { id: "gpt-5", provider: "openai" } } } })),
  };
}

function ctxBridge({ engine, rcAttached = false }) {
  const ef = engine || makeEngine();
  if (rcAttached) ef.rcState.attach("tg_dm_x@a1", "/fake.jsonl");
  return {
    engine: ef,
    sessionRef: { kind: "bridge", agentId: "a1", sessionKey: "tg_dm_x@a1" },
  };
}

describe("/rc command", () => {
  const c = cmd("rc");

  it("declares owner permission and core source", () => {
    expect(c).toBeTruthy();
    expect(c.permission).toBe("owner");
    expect(c.source).toBe("core");
  });

  it("rejects when sessionRef.kind is not bridge", async () => {
    const r = await c.handler({
      engine: makeEngine(),
      sessionRef: { kind: "desktop", agentId: "a1", sessionPath: "/x" },
    });
    expect(r.reply).toMatch(/只能在 bridge/);
  });

  it("returns error when rcState missing (defensive)", async () => {
    const engine = { listSessions: async () => [], getAgent: () => null, rcState: null };
    const r = await c.handler({
      engine,
      sessionRef: { kind: "bridge", agentId: "a1", sessionKey: "k" },
    });
    expect(r.error).toMatch(/rc 状态/);
  });

  it("rejects when already attached (must /exitrc first)", async () => {
    const ctx = ctxBridge({ rcAttached: true });
    const r = await c.handler(ctx);
    expect(r.reply).toMatch(/已处于接管态.*\/exitrc/);
  });

  it("replies 'no sessions' when agent has none", async () => {
    const engine = makeEngine({ sessions: [] });
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toMatch(/没有可接管的桌面会话/);
    expect(engine.rcState.isPending("tg_dm_x@a1")).toBe(false);
  });

  it("lists sessions, sets pending, returns menu as reply", async () => {
    const sessions = [
      { path: "/a/s1.jsonl", agentId: "a1", modified: new Date(), title: "架构讨论", messageCount: 12 },
      { path: "/a/s2.jsonl", agentId: "a1", modified: new Date(), title: "周报写作", messageCount: 3 },
    ];
    const engine = makeEngine({ sessions });
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toMatch(/选择要接管/);
    expect(r.reply).toContain("1. 架构讨论");
    expect(r.reply).toContain("2. 周报写作");
    expect(r.reply).toMatch(/\/exitrc/);
    expect(engine.rcState.isPending("tg_dm_x@a1")).toBe(true);
    const p = engine.rcState.getPending("tg_dm_x@a1");
    expect(p.type).toBe("rc-select");
    expect(p.options).toHaveLength(2);
    expect(p.options[0].path).toBe("/a/s1.jsonl");
  });

  it("titleless session uses '未命名 (date)' fallback", async () => {
    const engine = makeEngine({
      sessions: [{ path: "/a/s.jsonl", agentId: "a1", modified: new Date(), title: null, messageCount: 1 }],
    });
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toMatch(/未命名/);
  });

  it("filters to agentId (other agent's sessions not shown)", async () => {
    const engine = makeEngine({
      sessions: [
        { path: "/mine.jsonl", agentId: "a1", modified: new Date(), title: "mine", messageCount: 0 },
        { path: "/theirs.jsonl", agentId: "other", modified: new Date(), title: "theirs", messageCount: 0 },
      ],
    });
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toContain("mine");
    expect(r.reply).not.toContain("theirs");
  });

  it("caps at 10 sessions", async () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      ({ path: `/s${i}.jsonl`, agentId: "a1", modified: new Date(Date.now() - i * 1000), title: `T${i}`, messageCount: 0 }));
    const engine = makeEngine({ sessions });
    const r = await c.handler(ctxBridge({ engine }));
    const matches = r.reply.match(/^\d+\./gm) || [];
    expect(matches.length).toBe(10);
    expect(r.reply).toContain("10. T9");
    expect(r.reply).not.toMatch(/^11\./m);
  });
});

describe("/exitrc command", () => {
  const c = cmd("exitrc");

  it("declares owner permission and core source", () => {
    expect(c).toBeTruthy();
    expect(c.permission).toBe("owner");
    expect(c.source).toBe("core");
  });

  it("rejects when sessionRef.kind is not bridge", async () => {
    const r = await c.handler({
      engine: makeEngine(),
      sessionRef: { kind: "desktop", agentId: "a1", sessionPath: "/x" },
    });
    expect(r.reply).toMatch(/只能在 bridge/);
  });

  it("replies 'not attached' when nothing to exit", async () => {
    const engine = makeEngine();
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toMatch(/未处于接管状态/);
  });

  it("clears attachment and confirms exit", async () => {
    const engine = makeEngine();
    engine.rcState.attach("tg_dm_x@a1", "/some.jsonl");
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toMatch(/已退出接管/);
    expect(engine.rcState.isAttached("tg_dm_x@a1")).toBe(false);
  });

  it("clears pending-selection too when user exits during selection", async () => {
    const engine = makeEngine();
    engine.rcState.setPending("tg_dm_x@a1", { type: "rc-select", promptText: "p", options: [] });
    const r = await c.handler(ctxBridge({ engine }));
    expect(r.reply).toMatch(/已退出接管/);
    expect(engine.rcState.isPending("tg_dm_x@a1")).toBe(false);
  });
});
