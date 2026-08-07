import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createMemoryDreamRoute } from "../server/routes/memory-dream.ts";

function mount(agent: any) {
  const engine = {
    getAgent: vi.fn((id) => id === agent.id ? agent : null),
  };
  const app = new Hono();
  app.route("/api", createMemoryDreamRoute(engine));
  return { app, engine };
}

describe("Memory Dream routes", () => {
  it("requires explicit agentId and never falls back to focus", async () => {
    const startDream = vi.fn();
    const { app } = mount({
      id: "hana",
      memoryMasterEnabled: true,
      memoryTicker: { startDream },
    });

    const response = await app.request("/api/memories/dream/runs", { method: "POST" });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain("missing agentId");
    expect(startDream).not.toHaveBeenCalled();
  });

  it("starts a manual Dream for exactly the requested Agent", async () => {
    const startDream = vi.fn(() => ({
      status: "running",
      runId: "run-1",
      startedAt: "2026-08-08T10:00:00.000Z",
      lastRun: null,
    }));
    const { app } = mount({
      id: "hana",
      memoryMasterEnabled: true,
      memoryTicker: { startDream },
    });

    const response = await app.request("/api/memories/dream/runs?agentId=hana", { method: "POST" });
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data).toMatchObject({ agentId: "hana", status: "running", runId: "run-1" });
    expect(startDream).toHaveBeenCalledWith({ trigger: "manual" });
  });

  it("returns shared server status and restores an explicit revision", async () => {
    const getDreamStatus = vi.fn(() => ({
      status: "succeeded",
      runId: null,
      startedAt: null,
      lastRun: { revisionId: "rev-1" },
    }));
    const restoreDreamRevision = vi.fn(async () => ({ revisionId: "rev-1", restoredChars: 3200 }));
    const { app } = mount({
      id: "hana",
      memoryMasterEnabled: true,
      memoryTicker: { getDreamStatus, restoreDreamRevision },
    });

    const statusResponse = await app.request("/api/memories/dream/status?agentId=hana");
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ agentId: "hana", status: "succeeded" });

    const restoreResponse = await app.request(
      "/api/memories/dream/revisions/rev-1/restore?agentId=hana",
      { method: "POST" },
    );
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toMatchObject({ ok: true, revisionId: "rev-1" });
    expect(restoreDreamRevision).toHaveBeenCalledWith("rev-1");
  });

  it("refuses concurrent starts with a conflict", async () => {
    const error: Error & { code?: string } = new Error("already running");
    error.code = "DREAM_ALREADY_RUNNING";
    const { app } = mount({
      id: "hana",
      memoryMasterEnabled: true,
      memoryTicker: { startDream: vi.fn(() => { throw error; }) },
    });

    const response = await app.request("/api/memories/dream/runs?agentId=hana", { method: "POST" });
    expect(response.status).toBe(409);
  });
});
