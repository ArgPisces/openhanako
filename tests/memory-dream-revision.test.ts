import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyDreamSections,
  createDreamRevision,
  recoverPendingDreamApply,
  restoreDreamRevision,
  snapshotDreamSections,
} from "../lib/memory/dream/revision-store.ts";

function seed(memoryDir: string) {
  fs.mkdirSync(path.join(memoryDir, "daily"), { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "facts.md"), "old facts\n");
  fs.writeFileSync(path.join(memoryDir, "today.md"), "old today\n");
  fs.writeFileSync(path.join(memoryDir, "daily", "2026-08-07.md"), "## 2026-08-07\n\nold day\n");
  fs.writeFileSync(path.join(memoryDir, "week.md"), "## 2026-08-07\n\nold day\n");
  fs.writeFileSync(path.join(memoryDir, "longterm.md"), "old longterm\n");
  fs.writeFileSync(path.join(memoryDir, "memory.md"), "old compiled\n");
}

describe("Memory Dream revisions", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-dream-revision-"));
    memoryDir = path.join(tmpDir, "memory");
    seed(memoryDir);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("snapshots editable sources, applies atomically journaled sections, and restores them", () => {
    const before = snapshotDreamSections(memoryDir);
    const revision = createDreamRevision(memoryDir, {
      runId: "run-1",
      trigger: "manual",
      before,
    });
    applyDreamSections(memoryDir, {
      revision,
      next: {
        facts: "new facts",
        today: "new today",
        weekDays: [{ date: "2026-08-07", body: "new day" }],
        longterm: "new longterm",
      },
    });

    expect(fs.existsSync(path.join(memoryDir, "dream", "pending-apply.json"))).toBe(false);
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8")).toBe("new facts\n");
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toContain("new longterm");

    restoreDreamRevision(memoryDir, revision.revisionId);
    expect(snapshotDreamSections(memoryDir)).toEqual(before);
    expect(fs.existsSync(path.join(memoryDir, "dream", "pending-apply.json"))).toBe(false);
  });

  it("recovers the pre-run revision from a crash journal", () => {
    const before = snapshotDreamSections(memoryDir);
    const revision = createDreamRevision(memoryDir, {
      runId: "run-crash",
      trigger: "automatic",
      before,
    });
    fs.writeFileSync(path.join(memoryDir, "facts.md"), "partial new facts\n");
    fs.writeFileSync(path.join(memoryDir, "today.md"), "partial new today\n");
    fs.writeFileSync(path.join(memoryDir, "dream", "pending-apply.json"), JSON.stringify({
      schemaVersion: 1,
      revisionId: revision.revisionId,
    }));

    expect(recoverPendingDreamApply(memoryDir)).toBe(true);
    expect(snapshotDreamSections(memoryDir)).toEqual(before);
    expect(fs.existsSync(path.join(memoryDir, "dream", "pending-apply.json"))).toBe(false);
  });

  it("keeps only the ten newest revisions", () => {
    const before = snapshotDreamSections(memoryDir);
    for (let index = 0; index < 12; index += 1) {
      createDreamRevision(memoryDir, {
        runId: `run-${index}`,
        trigger: "manual",
        before,
      });
    }
    const revisionFiles = fs.readdirSync(path.join(memoryDir, "dream", "revisions"))
      .filter((name) => name.endsWith(".json"));
    expect(revisionFiles).toHaveLength(10);
  });

  it("refuses to invent or remove week dates", () => {
    const before = snapshotDreamSections(memoryDir);
    const revision = createDreamRevision(memoryDir, {
      runId: "run-dates",
      trigger: "manual",
      before,
    });

    expect(() => applyDreamSections(memoryDir, {
      revision,
      next: { ...before, weekDays: [{ date: "2026-08-06", body: "invented" }] },
    })).toThrow("only rewrite existing week dates");
  });
});
