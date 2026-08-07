import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyzeMock = vi.fn();
const writeMock = vi.fn();
const verifyMock = vi.fn();

vi.mock("../lib/memory/dream/model-runner.ts", () => ({
  analyzeDreamCandidates: (...args: any[]) => analyzeMock(...args),
  writeDreamSections: (...args: any[]) => writeMock(...args),
  verifyDreamSections: (...args: any[]) => verifyMock(...args),
  dreamModelId: () => "utility-test",
}));

import { createMemoryDreamRunner } from "../lib/memory/dream/runner.ts";

function seedMemory(memoryDir: string) {
  fs.mkdirSync(path.join(memoryDir, "daily"), { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "facts.md"), "User prefers concise answers.\n");
  fs.writeFileSync(path.join(memoryDir, "today.md"), "Discussed memory quality.\n");
  fs.writeFileSync(path.join(memoryDir, "daily", "2026-08-07.md"), "## 2026-08-07\n\nReviewed memory design.\n");
  fs.writeFileSync(path.join(memoryDir, "week.md"), "## 2026-08-07\n\nReviewed memory design.\n");
  fs.writeFileSync(path.join(memoryDir, "longterm.md"), "Hana is the user's personal agent.\n");
  fs.writeFileSync(path.join(memoryDir, "memory.md"), "old compiled memory\n");
}

async function waitForCompletion(runner: ReturnType<typeof createMemoryDreamRunner>) {
  await vi.waitFor(() => expect(runner.getStatus().status).not.toBe("running"));
  return runner.getStatus();
}

describe("Memory Dream runner", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    analyzeMock.mockReset();
    writeMock.mockReset();
    verifyMock.mockReset();
    verifyMock.mockResolvedValue({ ok: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-dream-runner-"));
    memoryDir = path.join(tmpDir, "memory");
    seedMemory(memoryDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRunner() {
    return createMemoryDreamRunner({
      memoryDir,
      memoryMdPath: path.join(memoryDir, "memory.md"),
      factStore: {
        getAll: () => [{
          id: 1,
          fact: "User prefers concise answers",
          tags: ["communication"],
          time: "2026-08-01T10:00:00.000Z",
          session_id: "session-a",
          created_at: "2026-08-01T10:00:00.000Z",
        }],
      } as any,
      getResolvedMemoryModel: async () => ({ model: { id: "utility-test" } }),
      getLogicalDate: () => "2026-08-08",
      onCompiled: vi.fn(),
    });
  }

  it("does not create Dream state until explicitly started", () => {
    makeRunner();
    expect(fs.existsSync(path.join(memoryDir, "dream"))).toBe(false);
  });

  it("applies a validated rewrite, keeps a revision, and can restore it", async () => {
    analyzeMock.mockResolvedValue([{
      groupId: "fact:number:1",
      action: "keep",
      subject: "user",
      temporal: "stable",
      canonicalFact: "User prefers concise answers",
      reasonCodes: ["recent"],
    }]);
    writeMock.mockImplementation(async ({ current }: any) => ({
      sections: {
        ...current,
        facts: "User prefers concise answers and dense technical reports.",
      },
      coverage: ["fact:number:1"],
      notes: ["Merged a recurring communication preference."],
    }));
    const runner = makeRunner();

    const started = runner.start({ trigger: "manual" });
    expect(started.status).toBe("running");
    const status = await waitForCompletion(runner);

    expect(status.status).toBe("succeeded");
    expect(writeMock.mock.calls[0]?.[0]?.budgets).toBeUndefined();
    expect(status.lastRun?.revisionId).toEqual(expect.any(String));
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8"))
      .toContain("dense technical reports");
    expect(fs.existsSync(path.join(memoryDir, "dream", "state.json"))).toBe(true);

    await runner.restoreRevision(status.lastRun!.revisionId!);
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8"))
      .toBe("User prefers concise answers.\n");
  });

  it("leaves every memory section unchanged when model writing fails", async () => {
    analyzeMock.mockResolvedValue([]);
    writeMock.mockRejectedValue(new Error("writer invalid"));
    const before = fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8");
    const runner = makeRunner();

    runner.start({ trigger: "manual" });
    const status = await waitForCompletion(runner);

    expect(status.status).toBe("failed");
    expect(status.lastRun?.error).toContain("writer invalid");
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8")).toBe(before);
    expect(fs.existsSync(path.join(memoryDir, "dream", "revisions"))).toBe(false);
  });

  it("records one automatic attempt per logical day before running the model", async () => {
    analyzeMock.mockRejectedValue(new Error("stop after eligibility check"));
    const runner = makeRunner();

    expect(runner.startAutomaticIfEligible("2026-08-08")?.status).toBe("running");
    expect(runner.startAutomaticIfEligible("2026-08-08")).toBeNull();
    const state = JSON.parse(fs.readFileSync(path.join(memoryDir, "dream", "state.json"), "utf-8"));
    expect(state.lastAutomaticAttemptDate).toBe("2026-08-08");
    await waitForCompletion(runner);
  });
});
