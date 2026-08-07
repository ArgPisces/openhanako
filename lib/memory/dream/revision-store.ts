import crypto from "crypto";
import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../../shared/safe-fs.ts";
import {
  assemble,
  assembleWeekFromDaily,
  listWeekDayEntries,
  readCompiledMemorySections,
  writeDailyEntryBody,
} from "../compile.ts";
import { dreamDir, type DreamRunTrigger } from "./state-store.ts";

export type DreamWeekDay = { date: string; body: string };
export type DreamSections = {
  facts: string;
  today: string;
  weekDays: DreamWeekDay[];
  longterm: string;
};

export type DreamRevision = {
  schemaVersion: 1;
  revisionId: string;
  runId: string;
  trigger: DreamRunTrigger;
  createdAt: string;
  before: DreamSections;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REVISIONS = 10;

function revisionsDir(memoryDir: string) {
  return path.join(dreamDir(memoryDir), "revisions");
}

function pendingPath(memoryDir: string) {
  return path.join(dreamDir(memoryDir), "pending-apply.json");
}

function revisionPath(memoryDir: string, revisionId: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(revisionId)) throw new Error("Invalid Dream revision id");
  return path.join(revisionsDir(memoryDir), `${revisionId}.json`);
}

export function snapshotDreamSections(memoryDir: string): DreamSections {
  const sections = readCompiledMemorySections(memoryDir);
  return {
    facts: sections.facts,
    today: sections.today,
    weekDays: listWeekDayEntries(memoryDir),
    longterm: sections.longterm,
  };
}

export function createDreamRevision(memoryDir: string, options: {
  runId: string;
  trigger: DreamRunTrigger;
  before: DreamSections;
}) {
  const revisionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const revision: DreamRevision = {
    schemaVersion: 1,
    revisionId,
    runId: options.runId,
    trigger: options.trigger,
    createdAt: new Date().toISOString(),
    before: options.before,
  };
  fs.mkdirSync(revisionsDir(memoryDir), { recursive: true });
  atomicWriteSync(revisionPath(memoryDir, revisionId), `${JSON.stringify(revision, null, 2)}\n`);
  pruneDreamRevisions(memoryDir);
  return revision;
}

export function readDreamRevision(memoryDir: string, revisionId: string): DreamRevision {
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(revisionPath(memoryDir, revisionId), "utf-8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new Error("Dream revision not found");
    throw new Error(`Dream revision is unreadable: ${err?.message || err}`);
  }
  if (raw?.schemaVersion !== 1 || raw?.revisionId !== revisionId || !raw?.before) {
    throw new Error("Dream revision has an invalid format");
  }
  return raw as DreamRevision;
}

function normalizeSections(sections: DreamSections) {
  const dates = new Set<string>();
  const weekDays = sections.weekDays.map((entry) => {
    if (!DATE_RE.test(entry?.date || "") || dates.has(entry.date)) {
      throw new Error("Dream output contains an invalid or duplicate week date");
    }
    dates.add(entry.date);
    return { date: entry.date, body: String(entry.body || "").trim() };
  });
  return {
    facts: String(sections.facts || "").trim(),
    today: String(sections.today || "").trim(),
    weekDays,
    longterm: String(sections.longterm || "").trim(),
  };
}

function writeSectionFile(filePath: string, body: string) {
  atomicWriteSync(filePath, body ? `${body}\n` : "");
}

function applyFiles(memoryDir: string, sections: DreamSections, memoryMdPath: string) {
  const normalized = normalizeSections(sections);
  const dailyDir = path.join(memoryDir, "daily");
  fs.mkdirSync(dailyDir, { recursive: true });

  writeSectionFile(path.join(memoryDir, "facts.md"), normalized.facts);
  writeSectionFile(path.join(memoryDir, "today.md"), normalized.today);
  writeSectionFile(path.join(memoryDir, "longterm.md"), normalized.longterm);
  for (const entry of normalized.weekDays) {
    writeDailyEntryBody(dailyDir, entry.date, entry.body);
  }
  assembleWeekFromDaily(dailyDir, path.join(memoryDir, "week.md"));
  assemble(
    path.join(memoryDir, "facts.md"),
    path.join(memoryDir, "today.md"),
    path.join(memoryDir, "week.md"),
    path.join(memoryDir, "longterm.md"),
    memoryMdPath,
  );
  return normalized;
}

export function applyDreamSections(memoryDir: string, options: {
  revision: DreamRevision;
  next: DreamSections;
  memoryMdPath?: string;
}) {
  const memoryMdPath = options.memoryMdPath || path.join(memoryDir, "memory.md");
  const currentDates = options.revision.before.weekDays.map((entry) => entry.date).sort();
  const nextDates = options.next.weekDays.map((entry) => entry.date).sort();
  if (JSON.stringify(currentDates) !== JSON.stringify(nextDates)) {
    throw new Error("Dream may only rewrite existing week dates");
  }

  fs.mkdirSync(dreamDir(memoryDir), { recursive: true });
  atomicWriteSync(pendingPath(memoryDir), `${JSON.stringify({
    schemaVersion: 1,
    revisionId: options.revision.revisionId,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  try {
    const normalized = applyFiles(memoryDir, options.next, memoryMdPath);
    fs.rmSync(pendingPath(memoryDir), { force: true });
    return normalized;
  } catch (err) {
    try {
      applyFiles(memoryDir, options.revision.before, memoryMdPath);
      fs.rmSync(pendingPath(memoryDir), { force: true });
    } catch (rollbackErr: any) {
      throw new Error(`Dream apply failed and rollback also failed: ${rollbackErr?.message || rollbackErr}`, { cause: err });
    }
    throw err;
  }
}

export function restoreDreamRevision(memoryDir: string, revisionId: string, memoryMdPath?: string) {
  const revision = readDreamRevision(memoryDir, revisionId);
  const current = snapshotDreamSections(memoryDir);
  const resolvedMemoryMdPath = memoryMdPath || path.join(memoryDir, "memory.md");
  fs.mkdirSync(dreamDir(memoryDir), { recursive: true });
  atomicWriteSync(pendingPath(memoryDir), `${JSON.stringify({
    schemaVersion: 1,
    revisionId: revision.revisionId,
    startedAt: new Date().toISOString(),
    operation: "restore",
  }, null, 2)}\n`);

  try {
    const restored = applyFiles(memoryDir, revision.before, resolvedMemoryMdPath);
    fs.rmSync(pendingPath(memoryDir), { force: true });
    return restored;
  } catch (err) {
    try {
      applyFiles(memoryDir, current, resolvedMemoryMdPath);
      fs.rmSync(pendingPath(memoryDir), { force: true });
    } catch (rollbackErr: any) {
      throw new Error(`Dream restore failed and rollback also failed: ${rollbackErr?.message || rollbackErr}`, { cause: err });
    }
    throw err;
  }
}

export function recoverPendingDreamApply(memoryDir: string, memoryMdPath?: string) {
  let pending: any;
  try {
    pending = JSON.parse(fs.readFileSync(pendingPath(memoryDir), "utf-8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw new Error(`Dream pending journal is unreadable: ${err?.message || err}`);
  }
  const revision = readDreamRevision(memoryDir, pending?.revisionId);
  applyFiles(memoryDir, revision.before, memoryMdPath || path.join(memoryDir, "memory.md"));
  fs.rmSync(pendingPath(memoryDir), { force: true });
  return true;
}

function pruneDreamRevisions(memoryDir: string) {
  const dir = revisionsDir(memoryDir);
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => ({ name: entry.name, stat: fs.statSync(path.join(dir, entry.name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  for (const file of files.slice(MAX_REVISIONS)) {
    fs.rmSync(path.join(dir, file.name), { force: true });
  }
}
