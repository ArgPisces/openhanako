import { callText } from "../../../core/llm-client.ts";
import { callTextConfigFromResolvedModel } from "../../../core/model-execution-config.ts";
import { getLocale } from "../../i18n.ts";
import { attachPromptLayoutMetadata, buildUtilityPromptLayout } from "../../llm/prompt-layout.ts";
import { withMemoryReasoningBuffer } from "../llm-budget.ts";
import { buildDreamAnalyzerPrompt, buildDreamVerifierPrompt, buildDreamWriterPrompt } from "../prompts/dream.ts";
import {
  prepareDreamUnits,
  validateAndRenderDreamUnitPlan,
  type DreamUnitPlan,
} from "./memory-units.ts";
import type { DreamSections } from "./revision-store.ts";
import type { DreamRunTrigger } from "./state-store.ts";
import { jaccardSimilarity, normalizeFactText, tokenizeFactText } from "./evidence.ts";

const ANALYSIS_BATCH_SIZE = 70;
const SUBJECTS = new Set(["user", "third_party", "fiction", "project", "unknown"]);
const TEMPORAL = new Set(["stable", "active", "closed", "obsolete", "unknown"]);
const ACTIONS = new Set(["keep", "merge", "forget", "review"]);
export const DREAM_MEMORY_HARD_MAX_CHARS = 5_000;

export type DreamAnalyzerInput = {
  groupId: string;
  canonicalFact: string;
  sourceFacts: string[];
  sourceFactIds?: string[];
  allowedActions: string[];
  protected: boolean;
  ruleAction: "keep" | "merge" | "forget" | "review";
  evidence: Record<string, unknown>;
  ruleReasons: string[];
};

export type DreamSemanticDecision = {
  groupId: string;
  action: "keep" | "merge" | "forget" | "review";
  subject: "user" | "third_party" | "fiction" | "project" | "unknown";
  temporal: "stable" | "active" | "closed" | "obsolete" | "unknown";
  canonicalFact: string;
  reasonCodes: string[];
};

function stripJsonFence(raw: string) {
  const text = String(raw || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function parseObject(raw: string) {
  const parsed = JSON.parse(stripJsonFence(raw));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("structured Dream response must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function usageContext(operation: string, trigger: DreamRunTrigger, resolvedModel: any, layout: any) {
  return attachPromptLayoutMetadata({
    source: {
      subsystem: "memory",
      operation,
      surface: "system",
      trigger,
    },
    attribution: {
      kind: "memory",
      agentId: resolvedModel?.usageAgentId || null,
    },
  }, layout.usageMetadata);
}

async function callStructured(options: {
  promptSpec: { cacheGroup: string; templateVersion: string; systemPrompt: string };
  userContent: string;
  resolvedModel: any;
  operation: string;
  trigger: DreamRunTrigger;
  maxTokens: number;
  signal?: AbortSignal;
}) {
  const run = async (userContent: string, operation: string) => {
    const layout = buildUtilityPromptLayout({
      cacheGroup: options.promptSpec.cacheGroup,
      templateVersion: options.promptSpec.templateVersion,
      systemPrompt: options.promptSpec.systemPrompt,
      userContent,
    });
    return callText({
      ...callTextConfigFromResolvedModel(options.resolvedModel),
      messages: layout.messages,
      systemPrompt: layout.systemPrompt,
      temperature: 0.1,
      maxTokens: withMemoryReasoningBuffer(options.maxTokens, options.resolvedModel),
      timeoutMs: 90_000,
      signal: options.signal,
      usageLedger: options.resolvedModel?.usageLedger,
      usageContext: usageContext(operation, options.trigger, options.resolvedModel, layout),
    }) as Promise<string>;
  };

  const raw = await run(options.userContent, options.operation);
  try {
    return parseObject(raw);
  } catch (err: any) {
    const repairInput = `${options.userContent}\n\nThe previous response was invalid JSON (${err?.message || err}). Return one corrected JSON object only. Previous response:\n${String(raw).slice(0, 12_000)}`;
    const repaired = await run(repairInput, `${options.operation}_repair`);
    return parseObject(repaired);
  }
}

function validateAnalysis(raw: Record<string, unknown>, batch: DreamAnalyzerInput[]) {
  if (!Array.isArray(raw.decisions)) throw new Error("Dream analyzer omitted decisions[]");
  const expected = new Map(batch.map((group) => [group.groupId, group]));
  const seen = new Set<string>();
  const decisions: DreamSemanticDecision[] = [];

  for (const item of raw.decisions as Record<string, unknown>[]) {
    const groupId = typeof item?.groupId === "string" ? item.groupId : "";
    const source = expected.get(groupId);
    if (!source || seen.has(groupId)) throw new Error("Dream analyzer returned an unknown or duplicate groupId");
    const action = typeof item.action === "string" ? item.action : "";
    const subject = typeof item.subject === "string" ? item.subject : "";
    const temporal = typeof item.temporal === "string" ? item.temporal : "";
    const canonicalFact = typeof item.canonicalFact === "string" ? item.canonicalFact.trim() : "";
    if (!ACTIONS.has(action) || !source.allowedActions.includes(action)) {
      throw new Error(`Dream analyzer chose a forbidden action for ${groupId}`);
    }
    if (source.protected && action === "forget") {
      throw new Error(`Dream analyzer attempted to forget protected candidate ${groupId}`);
    }
    if (!SUBJECTS.has(subject) || !TEMPORAL.has(temporal) || !canonicalFact) {
      throw new Error(`Dream analyzer returned invalid semantics for ${groupId}`);
    }
    const canonicalNormalized = normalizeFactText(canonicalFact);
    const sourceTexts = [source.canonicalFact, ...source.sourceFacts];
    const supportedCanonical = sourceTexts.some((text) => {
      const normalized = normalizeFactText(text);
      return normalized === canonicalNormalized
        || jaccardSimilarity(tokenizeFactText(normalized), tokenizeFactText(canonicalNormalized)) >= 0.45;
    });
    if (!supportedCanonical) {
      throw new Error(`Dream analyzer returned an unsupported canonical fact for ${groupId}`);
    }
    if (source.ruleAction === "keep" && action === "forget"
      && subject === "user" && !["closed", "obsolete"].includes(temporal)) {
      throw new Error(`Dream analyzer attempted to forget stable user evidence ${groupId}`);
    }
    seen.add(groupId);
    decisions.push({
      groupId,
      action: action as DreamSemanticDecision["action"],
      subject: subject as DreamSemanticDecision["subject"],
      temporal: temporal as DreamSemanticDecision["temporal"],
      canonicalFact,
      reasonCodes: Array.isArray(item.reasonCodes)
        ? item.reasonCodes.filter((value): value is string => typeof value === "string").slice(0, 8)
        : [],
    });
  }
  if (seen.size !== expected.size) throw new Error("Dream analyzer did not cover every candidate exactly once");
  return decisions;
}

export async function analyzeDreamCandidates(options: {
  groups: DreamAnalyzerInput[];
  resolvedModel: any;
  trigger: DreamRunTrigger;
  signal?: AbortSignal;
}) {
  const promptSpec = buildDreamAnalyzerPrompt(getLocale());
  const all: DreamSemanticDecision[] = [];
  for (const batch of chunk(options.groups, ANALYSIS_BATCH_SIZE)) {
    const userContent = JSON.stringify({ groups: batch });
    const raw = await callStructured({
      promptSpec,
      userContent,
      resolvedModel: options.resolvedModel,
      operation: "memory.dream.analyze",
      trigger: options.trigger,
      maxTokens: 8192,
      signal: options.signal,
    });
    try {
      all.push(...validateAnalysis(raw, batch));
    } catch (err: any) {
      const repaired = await callStructured({
        promptSpec,
        userContent: `${userContent}\n\nValidation error: ${err?.message || err}. Return corrected decisions covering each input groupId exactly once.`,
        resolvedModel: options.resolvedModel,
        operation: "memory.dream.analyze_validation_repair",
        trigger: options.trigger,
        maxTokens: 8192,
        signal: options.signal,
      });
      all.push(...validateAnalysis(repaired, batch));
    }
  }
  return all;
}

function unitPlanBodyChars(plan: DreamUnitPlan) {
  return plan.sections.facts.length
    + plan.sections.today.length
    + plan.sections.longterm.length
    + plan.sections.weekDays.reduce((sum, entry) => sum + entry.body.length, 0);
}

function writerSafetyLimit(current: DreamSections) {
  const preservedBodyChars = current.today.length
    + current.weekDays.reduce((sum, entry) => sum + entry.body.length, 0);
  const currentTotalBodyChars = current.facts.length
    + current.longterm.length
    + preservedBodyChars;
  const maxTotalBodyChars = Math.max(DREAM_MEMORY_HARD_MAX_CHARS, currentTotalBodyChars);
  return {
    maxTotalBodyChars,
    maxEditableBodyChars: Math.max(0, maxTotalBodyChars - preservedBodyChars),
    preservedBodyChars,
    role: "safety_ceiling_not_target" as const,
  };
}

function validateWriterResult(
  raw: Record<string, unknown>,
  prepared: ReturnType<typeof prepareDreamUnits>,
  maxTotalBodyChars: number,
) {
  const plan = validateAndRenderDreamUnitPlan(raw, prepared);
  const total = unitPlanBodyChars(plan);
  if (total > maxTotalBodyChars) {
    throw new Error(
      `Dream writer output is ${total} characters; the safety limit is ${maxTotalBodyChars}; no changes were applied`,
    );
  }
  return plan;
}

export async function writeDreamSections(options: {
  current: DreamSections;
  decisions: DreamSemanticDecision[];
  evidence: DreamAnalyzerInput[];
  resolvedModel: any;
  trigger: DreamRunTrigger;
  signal?: AbortSignal;
}) {
  const prepared = prepareDreamUnits(options);
  const promptSpec = buildDreamWriterPrompt(getLocale());
  const safetyLimit = writerSafetyLimit(options.current);
  const payload = {
    residentUnits: prepared.residentUnits,
    candidateUnits: prepared.candidateUnits,
    exactDuplicateOperations: prepared.exactDuplicateOperations,
    safetyLimit,
    constraints: {
      requiredResidentUnitIds: prepared.residentUnits.map((unit) => unit.id),
      requiredCandidateUnitIds: prepared.candidateUnits
        .filter((unit) => unit.action === "keep" || unit.action === "merge")
        .map((unit) => unit.id),
      factsPreferredOverLongtermForStableDuplicates: true,
      outputFormat: "plain_one_line_units",
    },
  };

  const raw = await callStructured({
    promptSpec,
    userContent: JSON.stringify(payload),
    resolvedModel: options.resolvedModel,
    operation: "memory.dream.write",
    trigger: options.trigger,
    maxTokens: 8192,
    signal: options.signal,
  });
  try {
    return validateWriterResult(raw, prepared, safetyLimit.maxTotalBodyChars);
  } catch (err: any) {
    const repairRaw = await callStructured({
      promptSpec,
      userContent: `${JSON.stringify(payload)}\n\nValidation error: ${err?.message || err}. Return corrected structured Facts/Longterm units grounded in source unit IDs, preserve every resident source, and stay below the single total-body safety ceiling. Today and Week are preserved by code and are not part of your output. The ceiling is not a target.`,
      resolvedModel: options.resolvedModel,
      operation: "memory.dream.write_validation_repair",
      trigger: options.trigger,
      maxTokens: 8192,
      signal: options.signal,
    });
    return validateWriterResult(repairRaw, prepared, safetyLimit.maxTotalBodyChars);
  }
}

export async function verifyDreamSections(options: {
  current: DreamSections;
  proposed: DreamSections;
  decisions: DreamSemanticDecision[];
  evidence: DreamAnalyzerInput[];
  resolvedModel: any;
  trigger: DreamRunTrigger;
  unitPlan?: DreamUnitPlan;
  signal?: AbortSignal;
}) {
  const promptSpec = buildDreamVerifierPrompt(getLocale());
  const raw = await callStructured({
    promptSpec,
    userContent: JSON.stringify({
      currentSections: options.current,
      currentUnits: options.unitPlan?.originalResidentUnits,
      candidateDecisions: options.decisions,
      measuredEvidence: options.evidence,
      requiredCandidateUnitIds: options.unitPlan?.candidateUnits
        .filter((unit) => unit.action === "keep" || unit.action === "merge")
        .map((unit) => unit.id) || [],
      exactDuplicateOperations: options.unitPlan?.exactDuplicateOperations,
      proposedUnits: options.unitPlan?.proposedUnits,
      removedUnits: options.unitPlan?.removedUnits,
      proposedSections: options.proposed,
    }),
    resolvedModel: options.resolvedModel,
    operation: "memory.dream.verify",
    trigger: options.trigger,
    maxTokens: 4096,
    signal: options.signal,
  });
  const missing = Array.isArray(raw.missingGroupIds)
    ? raw.missingGroupIds.filter((value): value is string => typeof value === "string")
    : [];
  const requiredCandidateUnitIds = options.unitPlan?.candidateUnits
    .filter((unit) => unit.action === "keep" || unit.action === "merge")
    .map((unit) => unit.id) || [];
  if (missing.some((id) => !requiredCandidateUnitIds.includes(id))) {
    throw new Error("Dream verifier returned an unknown required candidate unit id");
  }
  const unsupported = Array.isArray(raw.unsupportedClaims) ? raw.unsupportedClaims : [];
  const subjectLeaks = Array.isArray(raw.subjectLeaks) ? raw.subjectLeaks : [];
  const lostStable = Array.isArray(raw.lostStableClaims) ? raw.lostStableClaims : [];
  const duplicates = Array.isArray(raw.duplicateClaims) ? raw.duplicateClaims : [];
  const ok = raw.ok === true
    && missing.length === 0
    && unsupported.length === 0
    && subjectLeaks.length === 0
    && lostStable.length === 0
    && duplicates.length === 0;
  if (!ok) {
    throw new Error(
      `Dream verification failed: missing=${missing.length}, unsupported=${unsupported.length}, subjectLeaks=${subjectLeaks.length}, lostStable=${lostStable.length}, duplicates=${duplicates.length}`,
    );
  }
  return { ok: true as const };
}

export function dreamModelId(resolvedModel: any) {
  return String(resolvedModel?.model?.id || resolvedModel?.id || resolvedModel?.model || "");
}
