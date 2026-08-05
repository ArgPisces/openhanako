import { describe, expect, it, vi } from "vitest";
import { buildDesktopSlashSessionRef, createChatRoute } from "../server/routes/chat.ts";

describe("desktop slash session identity", () => {
  it("adds the stable session id resolved from the locator", () => {
    const engine = {
      getSessionIdForPath: vi.fn(() => "sess_a"),
    };

    expect(buildDesktopSlashSessionRef(engine, "agent-a", "/sessions/a.jsonl")).toEqual({
      kind: "desktop",
      agentId: "agent-a",
      sessionId: "sess_a",
      sessionPath: "/sessions/a.jsonl",
    });
  });

  it("keeps the locator for compatibility but does not synthesize identity", () => {
    const engine = {
      getSessionIdForPath: vi.fn(() => null),
    };

    expect(buildDesktopSlashSessionRef(engine, "agent-a", "/sessions/legacy.jsonl")).toEqual({
      kind: "desktop",
      agentId: "agent-a",
      sessionPath: "/sessions/legacy.jsonl",
    });
  });
});

/**
 * The slash handler resolves the agent from the loaded session first and from the
 * client payload second. A session the server has not loaded (the usual state for a
 * remote/mobile client that only ever talked to the HTTP routes) leaves the first
 * source empty, so the payload has to carry the identity or the command dies on an
 * assertion the user can do nothing about.
 */
describe("slash WS handler agent identity", () => {
  function mountSlashRoute({ sessionAgentId = null, handled = true } = {}) {
    let createHandlers: any;
    const upgradeWebSocket = vi.fn((factory: any) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const tryDispatch = vi.fn(async (_text: string, _ctx: any) => ({ handled }));
    const hub = {
      subscribe: vi.fn(),
      send: vi.fn(async () => {}),
      eventBus: { emit: vi.fn() },
    };
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => (sessionAgentId ? { agentId: sessionAgentId, entries: [] } : null)),
      getSessionIdForPath: vi.fn(() => "sess_a"),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      slashDispatcher: { tryDispatch },
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = { readyState: 1, send: vi.fn() };
    handlers.onOpen({}, ws);
    const sent = () => ws.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    return { handlers, ws, tryDispatch, sent };
  }

  it("dispatches with the agent id the client carried when the session is not loaded", async () => {
    const { handlers, ws, tryDispatch, sent } = mountSlashRoute();

    handlers.onMessage({
      data: JSON.stringify({
        type: "slash",
        text: "/stop",
        sessionPath: "/sessions/remote.jsonl",
        agentId: "agent-remote",
      }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tryDispatch).toHaveBeenCalledTimes(1);
    expect(tryDispatch.mock.calls[0][1].sessionRef).toMatchObject({ agentId: "agent-remote" });
    expect(sent().find((payload: any) => payload.type === "error")).toBeUndefined();
  });

  it("labels a slash with no identity at all as an internal contract violation", async () => {
    const { handlers, ws, tryDispatch, sent } = mountSlashRoute();

    handlers.onMessage({
      data: JSON.stringify({ type: "slash", text: "/stop", sessionPath: "/sessions/remote.jsonl" }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tryDispatch).not.toHaveBeenCalled();
    expect(sent().find((payload: any) => payload.type === "error")).toEqual({
      type: "error",
      code: "internal_contract",
      message: "agentId required",
      sessionPath: "/sessions/remote.jsonl",
    });
  });

  it("still prefers the loaded session's own agent over the payload", async () => {
    const { handlers, ws, tryDispatch } = mountSlashRoute({ sessionAgentId: "agent-loaded" });

    handlers.onMessage({
      data: JSON.stringify({
        type: "slash",
        text: "/stop",
        sessionPath: "/sessions/loaded.jsonl",
        agentId: "agent-remote",
      }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tryDispatch.mock.calls[0][1].sessionRef).toMatchObject({ agentId: "agent-loaded" });
  });
});
