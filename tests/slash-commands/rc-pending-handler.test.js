import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock summary module so tests don't touch real LLM plumbing
vi.mock("../../core/slash-commands/rc-summary.js", () => ({
  summarizeSessionForRc: vi.fn(),
}));

import { summarizeSessionForRc } from "../../core/slash-commands/rc-summary.js";
import { handleRcPendingInput } from "../../core/slash-commands/rc-pending-handler.js";
import { RcStateStore } from "../../core/slash-commands/rc-state.js";

function makeEngine({ isStreaming = () => false, agents = {} } = {}) {
  const rcState = new RcStateStore();
  return {
    rcState,
    isSessionStreaming: vi.fn(isStreaming),
    getAgent: vi.fn((id) => agents[id] || null),
  };
}

function prime(engine, sessionKey, options) {
  engine.rcState.setPending(sessionKey, {
    type: "rc-select",
    promptText: "menu",
    options,
  });
}

beforeEach(() => {
  summarizeSessionForRc.mockReset();
});

describe("handleRcPendingInput — parsing", () => {
  it("returns handled=false when no pending state exists", async () => {
    const engine = makeEngine();
    const reply = vi.fn();
    const r = await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "2", reply,
    });
    expect(r).toEqual({ handled: false });
    expect(reply).not.toHaveBeenCalled();
  });

  it("returns handled=false when pending type is unknown (future-proof)", async () => {
    const engine = makeEngine();
    // Manually insert a pending of a type we don't handle yet
    engine.rcState._pending.set("k", {
      type: "yes-no", promptText: "y/n", options: [], expiresAt: Date.now() + 60_000,
    });
    const reply = vi.fn();
    const r = await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "yes", reply,
    });
    expect(r).toEqual({ handled: false });
  });

  it("non-numeric text → replies 'please enter a number' and keeps pending", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/a.jsonl", title: "A" }, { path: "/b.jsonl", title: "B" }]);
    const reply = vi.fn();
    const r = await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "昨天那个", reply,
    });
    expect(r.handled).toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/请输入数字编号.*1-2/));
    // pending 保留（用户可以继续尝试）
    expect(engine.rcState.isPending("k")).toBe(true);
  });

  it("out-of-range number → replies 'out of range' and keeps pending", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/a.jsonl", title: "A" }]);
    const reply = vi.fn();
    const r = await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "5", reply,
    });
    expect(r.handled).toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/编号超出范围.*1-1/));
    expect(engine.rcState.isPending("k")).toBe(true);
  });

  it("'0' is out-of-range (boundary test)", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/a.jsonl", title: "A" }]);
    const reply = vi.fn();
    await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "0", reply,
    });
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/编号超出范围/));
  });

  it("leading/trailing whitespace is tolerated", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/a.jsonl", title: "A" }]);
    summarizeSessionForRc.mockResolvedValueOnce("sum");
    const reply = vi.fn();
    const r = await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "  1  ", reply,
    });
    expect(r.handled).toBe(true);
    expect(engine.rcState.isAttached("k")).toBe(true);
  });
});

describe("handleRcPendingInput — selection success flow", () => {
  it("valid selection → progress reply + summary + attach + completion reply", async () => {
    const engine = makeEngine();
    prime(engine, "k", [
      { path: "/sess/a.jsonl", title: "讨论架构" },
      { path: "/sess/b.jsonl", title: "周报" },
    ]);
    summarizeSessionForRc.mockResolvedValueOnce("聊了 Bridge 路由设计");
    const reply = vi.fn();
    const r = await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "1", reply,
    });
    expect(r.handled).toBe(true);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[0][0]).toMatch(/正在接管/);
    expect(reply.mock.calls[1][0]).toContain("讨论架构");
    expect(reply.mock.calls[1][0]).toContain("聊了 Bridge 路由设计");
    // attach 建立，pending 清除
    expect(engine.rcState.isAttached("k")).toBe(true);
    expect(engine.rcState.getAttachment("k").desktopSessionPath).toBe("/sess/a.jsonl");
    expect(engine.rcState.isPending("k")).toBe(false);
  });

  it("summary returns null → falls back to '已接管对话 <title>'", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/sess/a.jsonl", title: "架构设计" }]);
    summarizeSessionForRc.mockResolvedValueOnce(null);
    const reply = vi.fn();
    await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "1", reply,
    });
    expect(reply.mock.calls[1][0]).toBe("已接管对话 架构设计");
  });

  it("summary throws → still attaches, uses fallback text", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/sess/a.jsonl", title: "bug fix" }]);
    summarizeSessionForRc.mockRejectedValueOnce(new Error("boom"));
    const reply = vi.fn();
    await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "1", reply,
    });
    expect(engine.rcState.isAttached("k")).toBe(true);
    expect(reply.mock.calls[1][0]).toBe("已接管对话 bug fix");
  });

  it("target session without title → uses '未命名会话' fallback", async () => {
    const engine = makeEngine();
    prime(engine, "k", [{ path: "/sess/a.jsonl", title: null }]);
    summarizeSessionForRc.mockResolvedValueOnce(null);
    const reply = vi.fn();
    await handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "1", reply,
    });
    expect(reply.mock.calls[1][0]).toBe("已接管对话 未命名会话");
  });
});

describe("handleRcPendingInput — streaming wait", () => {
  it("target session is streaming → polls; cancels after 30s deadline", async () => {
    vi.useFakeTimers();
    const engine = makeEngine({ isStreaming: () => true });
    prime(engine, "k", [{ path: "/sess/a.jsonl", title: "busy" }]);
    const reply = vi.fn();
    const promise = handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "1", reply,
    });
    // Advance past 30s deadline
    await vi.advanceTimersByTimeAsync(31_000);
    const r = await promise;
    expect(r.handled).toBe(true);
    expect(reply.mock.calls[0][0]).toMatch(/正在接管/);
    expect(reply.mock.calls[1][0]).toMatch(/持续在回复中.*取消/);
    expect(engine.rcState.isAttached("k")).toBe(false);
    vi.useRealTimers();
  });

  it("session becomes idle mid-wait → proceeds to attach", async () => {
    vi.useFakeTimers();
    let streaming = true;
    const engine = makeEngine({ isStreaming: () => streaming });
    prime(engine, "k", [{ path: "/sess/a.jsonl", title: "biz" }]);
    summarizeSessionForRc.mockResolvedValueOnce("done");
    const reply = vi.fn();
    const promise = handleRcPendingInput({
      engine, agentId: "a1", sessionKey: "k", text: "1", reply,
    });
    // simulate stream ending after 1s
    await vi.advanceTimersByTimeAsync(1_000);
    streaming = false;
    await vi.advanceTimersByTimeAsync(500);
    const r = await promise;
    expect(r.handled).toBe(true);
    expect(engine.rcState.isAttached("k")).toBe(true);
    vi.useRealTimers();
  });
});
