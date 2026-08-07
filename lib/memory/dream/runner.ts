import crypto from "crypto";
import type { FactStore } from "../fact-store.ts";
import { buildCompiledMemoryMarkdown } from "../compile.ts";
import { buildFactEvidence, normalizeFactText } from "./evidence.ts";
import { aggregateFactDecisionsByGroup, decideFactActions } from "./policy.ts";
import type { FactDecision, FactRecord } from "./types.ts";
import {
  analyzeDreamCandidates,
  dreamModelId,
  verifyDreamSections,
  writeDreamSections,
  type DreamAnalyzerInput,
  type DreamSectionBudgets,
} from "./model-runner.ts";
import {
  applyDreamSections,
  createDreamRevision,
  recoverPendingDreamApply,
  restoreDreamRevision as restoreRevisionFiles,
  snapshotDreamSections,
  type DreamSections,
} from "./revision-store.ts";
import {
  emptyDreamState,
  readDreamState,
  writeDreamState,
  type DreamPersistentState,
  type DreamRunReport,
  type DreamRunTrigger,
} from "./state-store.ts";

const MAX_MODEL_CANDIDATES = 48;
const DOMAIN_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export class DreamAlreadyRunningError extends Error {
  code = "DREAM_ALREADY_RUNNING";

  constructor() {
    super("A Memory Dream is already running for this agent");
  }
}

type DreamRuntimeStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  runId: string | null;
  startedAt: string | null;
  lastRun: DreamRunReport | null;
};

type CreateMemoryDreamRunnerOptions = {
  memoryDir: string;
  memoryMdPath: string;
  factStore: FactStore;
  getResolvedMemoryModel: () => Promise<any>;
  getLogicalDate: () => string;
  onCompiled?: () => void;
};

function sectionBodyChars(sections: DreamSections) {
  return sections.facts.length
    + sections.today.length
    + sections.longterm.length
    + sections.weekDays.reduce((sum, entry) => sum + entry.body.length, 0);
}

function compiledChars(sections: DreamSections) {
  return buildCompiledMemoryMarkdown({
    facts: sections.facts,
    today: sections.today,
    week: sections.weekDays.map((entry) => `### ${entry.date}\n\n${entry.body}`).join("\n\n"),
    longterm: sections.longterm,
  }).length;
}

function inputHash(sections: DreamSections) {
  return crypto.createHash("sha256").update(JSON.stringify(sections)).digest("hex");
}

function timeMs(fact: FactRecord) {
  for (const value of [fact.time, fact.created_at]) {
    const parsed = value ? Date.parse(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function activeDomainTags(facts: FactRecord[], now = Date.now()) {
  const counts = new Map<string, Set<string>>();
  const cutoff = now - DOMAIN_WINDOW_DAYS * DAY_MS;
  for (const fact of facts) {
    const timestamp = timeMs(fact);
    if (timestamp !== null && timestamp < cutoff) continue;
    const sessionKey = fact.session_id?.trim() || `fact:${String(fact.id)}`;
    for (const rawTag of fact.tags || []) {
      const tag = normalizeFactText(rawTag);
      if (!tag) continue;
      const sessions = counts.get(tag) || new Set<string>();
      sessions.add(sessionKey);
      counts.set(tag, sessions);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([tag]) => tag);
}

function decisionStrength(decision: FactDecision) {
  const evidence = decision.evidence;
  return [
    evidence.isProtected || evidence.isPinned ? 1 : 0,
    evidence.distinctSessionCount,
    evidence.distinctDayCount,
    evidence.domainTagOverlapCount,
    evidence.occurrenceCount,
    evidence.ageDays === null ? -1_000_000 : -evidence.ageDays,
  ];
}

function compareStrength(left: FactDecision, right: FactDecision) {
  const leftStrength = decisionStrength(left);
  const rightStrength = decisionStrength(right);
  for (let index = 0; index < leftStrength.length; index += 1) {
    if (leftStrength[index] !== rightStrength[index]) return rightStrength[index] - leftStrength[index];
  }
  return left.groupId.localeCompare(right.groupId, "en");
}

function analyzerInput(decision: FactDecision, factById: Map<string, FactRecord>): DreamAnalyzerInput {
  const sourceFacts = decision.sourceFactIds
    .map((id) => factById.get(String(id))?.fact)
    .filter((fact): fact is string => typeof fact === "string" && fact.trim().length > 0);
  const allowedActions = decision.action === "keep" && !decision.evidence.isProtected && !decision.evidence.isPinned
    ? ["keep", "merge", "forget", "review"]
    : [...decision.allowedActions];
  return {
    groupId: decision.groupId,
    canonicalFact: decision.canonicalFact,
    sourceFacts,
    allowedActions,
    protected: decision.evidence.isProtected || decision.evidence.isPinned,
    ruleAction: decision.action,
    evidence: {
      occurrenceCount: decision.evidence.occurrenceCount,
      distinctSessionCount: decision.evidence.distinctSessionCount,
      distinctDayCount: decision.evidence.distinctDayCount,
      ageDays: decision.evidence.ageDays,
      mostRecentAt: decision.evidence.mostRecentAt,
      observedTags: decision.evidence.observedTags,
      domainTagOverlap: decision.evidence.domainTagOverlap,
      duplicateKind: decision.evidence.duplicateKind,
    },
    ruleReasons: decision.reasons.map((reason) => reason.code),
  };
}

function budgetsFor(current: DreamSections): DreamSectionBudgets {
  const target = Math.max(3_000, Math.min(5_000, sectionBodyChars(current)));
  const facts = Math.floor(target * 0.30);
  const today = Math.floor(target * 0.18);
  const week = Math.min(1_200, Math.floor(target * 0.24));
  const longterm = target - facts - today - week;
  return { facts, today, week, longterm, hardTotal: target + 400 };
}

export function createMemoryDreamRunner(options: CreateMemoryDreamRunnerOptions) {
  let running: Promise<DreamRunReport> | null = null;
  let abortController: AbortController | null = null;
  let stateLoaded = false;
  let state: DreamPersistentState = emptyDreamState();
  let runtime: DreamRuntimeStatus = {
    status: "idle",
    runId: null,
    startedAt: null,
    lastRun: null,
  };

  const ensureState = () => {
    if (!stateLoaded) {
      state = readDreamState(options.memoryDir);
      runtime.lastRun = state.lastRun;
      if (state.lastRun) runtime.status = state.lastRun.status;
      stateLoaded = true;
    }
    return state;
  };

  const persist = (next: DreamPersistentState) => {
    state = writeDreamState(options.memoryDir, next);
    stateLoaded = true;
  };

  const runCore = async ({
    runId,
    trigger,
    logicalDate,
    startedAt,
    signal,
  }: {
    runId: string;
    trigger: DreamRunTrigger;
    logicalDate: string;
    startedAt: string;
    signal: AbortSignal;
  }) => {
    let before: DreamSections | null = null;
    let model = "";
    try {
      if (recoverPendingDreamApply(options.memoryDir, options.memoryMdPath)) {
        options.onCompiled?.();
      }
      before = snapshotDreamSections(options.memoryDir);
      const beforeHash = inputHash(before);
      const facts = options.factStore.getAll() as FactRecord[];
      if (sectionBodyChars(before) === 0 && facts.length === 0) {
        throw new Error("There is no memory to organize yet");
      }

      const evidence = buildFactEvidence(facts, {
        now: Date.now(),
        domainTags: activeDomainTags(facts),
      });
      const grouped = aggregateFactDecisionsByGroup(decideFactActions(evidence.facts));
      const eligible = grouped
        .filter((decision) => decision.action !== "forget")
        .sort(compareStrength)
        .slice(0, MAX_MODEL_CANDIDATES);
      const factById = new Map(facts.map((fact) => [String(fact.id), fact]));
      const analyzerInputs = eligible.map((decision) => analyzerInput(decision, factById));

      const resolvedModel = await options.getResolvedMemoryModel();
      model = dreamModelId(resolvedModel);
      const semanticDecisions = analyzerInputs.length > 0
        ? await analyzeDreamCandidates({
            groups: analyzerInputs,
            resolvedModel,
            trigger,
            signal,
          })
        : [];
      const writerResult = await writeDreamSections({
        current: before,
        decisions: semanticDecisions,
        evidence: analyzerInputs,
        budgets: budgetsFor(before),
        resolvedModel,
        trigger,
        signal,
      });
      await verifyDreamSections({
        current: before,
        proposed: writerResult.sections,
        decisions: semanticDecisions,
        evidence: analyzerInputs,
        resolvedModel,
        trigger,
        signal,
      });

      if (signal.aborted) throw new DOMException("Dream aborted", "AbortError");
      const current = snapshotDreamSections(options.memoryDir);
      if (inputHash(current) !== beforeHash) {
        throw new Error("Memory changed while Dream was running; no changes were applied");
      }

      const revision = createDreamRevision(options.memoryDir, { runId, trigger, before });
      const applied = applyDreamSections(options.memoryDir, {
        revision,
        next: writerResult.sections,
        memoryMdPath: options.memoryMdPath,
      });
      options.onCompiled?.();

      const finishedAt = new Date().toISOString();
      const semanticForgotten = semanticDecisions.filter((decision) => decision.action === "forget").length;
      const report: DreamRunReport = {
        runId,
        trigger,
        status: "succeeded",
        startedAt,
        finishedAt,
        logicalDate,
        beforeChars: compiledChars(before),
        afterChars: compiledChars(applied),
        mergedCount: evidence.duplicateGroups.reduce((sum, group) => sum + group.members.length - 1, 0),
        forgottenCount: grouped.filter((decision) => decision.action === "forget").length + semanticForgotten,
        reviewedCount: semanticDecisions.filter((decision) => decision.action === "review").length,
        model,
        revisionId: revision.revisionId,
        notes: writerResult.notes,
      };
      const currentState = ensureState();
      persist({
        ...currentState,
        lastSuccessfulManualDate: trigger === "manual" ? logicalDate : currentState.lastSuccessfulManualDate,
        lastRun: report,
      });
      return report;
    } catch (err: any) {
      const finishedAt = new Date().toISOString();
      const report: DreamRunReport = {
        runId,
        trigger,
        status: "failed",
        startedAt,
        finishedAt,
        logicalDate,
        beforeChars: before ? compiledChars(before) : 0,
        afterChars: before ? compiledChars(before) : 0,
        mergedCount: 0,
        forgottenCount: 0,
        reviewedCount: 0,
        model,
        revisionId: null,
        notes: [],
        error: err?.message || String(err),
      };
      const currentState = ensureState();
      persist({ ...currentState, lastRun: report });
      return report;
    }
  };

  function start({
    trigger = "manual",
    logicalDate = options.getLogicalDate(),
  }: {
    trigger?: DreamRunTrigger;
    logicalDate?: string;
  } = {}) {
    if (running) throw new DreamAlreadyRunningError();
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    abortController = new AbortController();
    runtime = { status: "running", runId, startedAt, lastRun: ensureState().lastRun };

    if (trigger === "automatic") {
      persist({ ...ensureState(), lastAutomaticAttemptDate: logicalDate });
    }

    const promise = runCore({
      runId,
      trigger,
      logicalDate,
      startedAt,
      signal: abortController.signal,
    });
    running = promise;
    promise.then((report) => {
      runtime = { status: report.status, runId: null, startedAt: null, lastRun: report };
    }).finally(() => {
      if (running === promise) running = null;
      abortController = null;
    });
    return { status: "running" as const, runId, startedAt, lastRun: runtime.lastRun };
  }

  function startAutomaticIfEligible(logicalDate = options.getLogicalDate()) {
    const currentState = ensureState();
    if (currentState.lastAutomaticAttemptDate === logicalDate) return null;
    if (currentState.lastSuccessfulManualDate === logicalDate) return null;
    if (running) return null;
    return start({ trigger: "automatic", logicalDate });
  }

  function getStatus() {
    ensureState();
    return { ...runtime, lastRun: runtime.lastRun ? { ...runtime.lastRun } : null };
  }

  async function restoreRevision(revisionId: string) {
    if (running) throw new DreamAlreadyRunningError();
    if (recoverPendingDreamApply(options.memoryDir, options.memoryMdPath)) {
      options.onCompiled?.();
    }
    const restored = restoreRevisionFiles(options.memoryDir, revisionId, options.memoryMdPath);
    options.onCompiled?.();
    return { revisionId, restoredChars: compiledChars(restored) };
  }

  async function stop() {
    abortController?.abort();
    if (running) await running.catch(() => {});
  }

  function isRunning() {
    return running !== null;
  }

  return {
    start,
    startAutomaticIfEligible,
    getStatus,
    restoreRevision,
    stop,
    isRunning,
  };
}
