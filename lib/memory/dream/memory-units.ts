import { jaccardSimilarity, normalizeFactText, tokenizeFactText } from "./evidence.ts";
import type { DreamAnalyzerInput, DreamSemanticDecision } from "./model-runner.ts";
import type { DreamSections } from "./revision-store.ts";

export type MemoryUnitSection = "facts" | "today" | "week" | "longterm";
export type MemoryUnitOrigin = "resident" | "fact_candidate";
export type DreamUnitRelation =
  | "unchanged"
  | "split"
  | "same_meaning"
  | "subsumes"
  | "related_but_distinct"
  | "conflict";

export type DreamMemoryUnit = {
  id: string;
  origin: MemoryUnitOrigin;
  section: MemoryUnitSection;
  date?: string;
  text: string;
  sourceRefs: string[];
  order: number;
  groupId?: string;
  action?: DreamSemanticDecision["action"];
  subject?: DreamSemanticDecision["subject"];
  temporal?: DreamSemanticDecision["temporal"];
};

export type ExactDuplicateOperation = {
  kind: "remove_exact_duplicate";
  canonicalUnitId: string;
  removedUnitIds: string[];
};

export type DreamProposedUnit = {
  id: string;
  sourceUnitIds: string[];
  text: string;
  section: MemoryUnitSection;
  date?: string;
  relation: DreamUnitRelation;
  order: number;
};

export type DreamRemovedUnit = {
  sourceUnitId: string;
  supportingCandidateUnitIds: string[];
  reason: "closed" | "obsolete";
};

export type DreamUnitOperation =
  | ExactDuplicateOperation
  | {
      kind: "merge" | "split" | "rewrite";
      sourceUnitIds: string[];
      resultUnitIds: string[];
    }
  | {
      kind: "forget";
      sourceUnitIds: string[];
      resultUnitIds: [];
    };

export type PreparedDreamUnits = {
  originalResidentUnits: DreamMemoryUnit[];
  residentUnits: DreamMemoryUnit[];
  candidateUnits: DreamMemoryUnit[];
  exactDuplicateOperations: ExactDuplicateOperation[];
  weekDates: string[];
  preservedToday: string;
  preservedWeekDays: DreamSections["weekDays"];
};

export type DreamUnitPlan = PreparedDreamUnits & {
  proposedUnits: DreamProposedUnit[];
  removedUnits: DreamRemovedUnit[];
  operations: DreamUnitOperation[];
  sections: DreamSections;
  mergedCount: number;
  forgottenCount: number;
};

const LIST_PREFIX_RE = /^\s*(?:[-*+]\s+|\d+[.)、]\s*)/;
const HEADING_PREFIX_RE = /^\s*#{1,6}\s+/;
const EMPTY_PLACEHOLDERS = new Set(["（暂无）", "(none)", "none"]);
const RELATIONS = new Set<DreamUnitRelation>([
  "unchanged",
  "split",
  "same_meaning",
  "subsumes",
  "related_but_distinct",
  "conflict",
]);
const SECTIONS = new Set<MemoryUnitSection>(["facts", "today", "week", "longterm"]);

function cleanInputLine(line: string) {
  const value = line
    .replace(LIST_PREFIX_RE, "")
    .replace(HEADING_PREFIX_RE, "")
    .trim();
  return EMPTY_PLACEHOLDERS.has(value.toLowerCase()) ? "" : value;
}

function bodyLines(body: string) {
  const units: string[] = [];
  let heading = "";
  const contextualize = (text: string) => {
    if (!heading || normalizeFactText(text).startsWith(normalizeFactText(heading))) return text;
    return `${heading}: ${text}`;
  };

  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (HEADING_PREFIX_RE.test(rawLine)) {
      heading = cleanInputLine(rawLine);
      continue;
    }
    const text = cleanInputLine(rawLine);
    if (text) units.push(contextualize(text));
  }
  return units;
}

function residentId(section: MemoryUnitSection, index: number, date?: string) {
  return date ? `resident:${section}:${date}:${index}` : `resident:${section}:${index}`;
}

export function atomizeDreamSections(sections: DreamSections) {
  const units: DreamMemoryUnit[] = [];
  let order = 0;
  const addBody = (body: string, section: MemoryUnitSection, date?: string) => {
    bodyLines(body).forEach((text, index) => {
      const id = residentId(section, index, date);
      units.push({
        id,
        origin: "resident",
        section,
        ...(date ? { date } : {}),
        text,
        sourceRefs: [`memory:${section}${date ? `:${date}` : ""}:${index}`],
        order: order++,
      });
    });
  };
  addBody(sections.facts, "facts");
  addBody(sections.longterm, "longterm");
  return units;
}

function canonicalResident(left: DreamMemoryUnit, right: DreamMemoryUnit) {
  if (left.section === "facts" && right.section === "longterm") return left;
  if (right.section === "facts" && left.section === "longterm") return right;
  return left.order <= right.order ? left : right;
}

export function removeExactResidentDuplicates(units: DreamMemoryUnit[]) {
  const groups = new Map<string, DreamMemoryUnit[]>();
  for (const unit of units) {
    const normalized = normalizeFactText(unit.text);
    if (!normalized) continue;
    const group = groups.get(normalized) || [];
    group.push(unit);
    groups.set(normalized, group);
  }

  const removedIds = new Set<string>();
  const operations: ExactDuplicateOperation[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = group.reduce(canonicalResident);
    const removed = group
      .filter((unit) => unit.id !== canonical.id)
      .sort((left, right) => left.order - right.order);
    for (const unit of removed) removedIds.add(unit.id);
    operations.push({
      kind: "remove_exact_duplicate",
      canonicalUnitId: canonical.id,
      removedUnitIds: removed.map((unit) => unit.id),
    });
    canonical.sourceRefs = [...new Set([
      ...canonical.sourceRefs,
      ...removed.flatMap((unit) => unit.sourceRefs),
    ])];
  }
  return {
    units: units.filter((unit) => !removedIds.has(unit.id)),
    operations,
  };
}

export function buildCandidateMemoryUnits(
  decisions: DreamSemanticDecision[],
  evidence: DreamAnalyzerInput[],
  startOrder: number,
) {
  const evidenceByGroup = new Map(evidence.map((entry) => [entry.groupId, entry]));
  return decisions.map((decision, index): DreamMemoryUnit => {
    const measured = evidenceByGroup.get(decision.groupId);
    const sourceFactIds = measured?.sourceFactIds?.length
      ? measured.sourceFactIds
      : [decision.groupId];
    return {
      id: `candidate:${decision.groupId}`,
      origin: "fact_candidate",
      section: decision.temporal === "closed" || decision.temporal === "obsolete" ? "longterm" : "facts",
      text: decision.canonicalFact.trim(),
      sourceRefs: sourceFactIds.map((id) => `facts.db:${String(id)}`),
      order: startOrder + index,
      groupId: decision.groupId,
      action: decision.action,
      subject: decision.subject,
      temporal: decision.temporal,
    };
  });
}

export function prepareDreamUnits(options: {
  current: DreamSections;
  decisions: DreamSemanticDecision[];
  evidence: DreamAnalyzerInput[];
}): PreparedDreamUnits {
  const originalResidentUnits = atomizeDreamSections(options.current);
  const deduped = removeExactResidentDuplicates(originalResidentUnits.map((unit) => ({ ...unit })));
  return {
    originalResidentUnits,
    residentUnits: deduped.units,
    candidateUnits: buildCandidateMemoryUnits(
      options.decisions,
      options.evidence,
      originalResidentUnits.length,
    ),
    exactDuplicateOperations: deduped.operations,
    weekDates: options.current.weekDays.map((entry) => entry.date),
    preservedToday: options.current.today,
    preservedWeekDays: options.current.weekDays.map((entry) => ({ ...entry })),
  };
}

function parseStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Dream unit writer ${field} must be a string array`);
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function validatePlainUnitText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error("Dream unit writer returned an empty unit");
  if (/\r|\n/.test(text) || LIST_PREFIX_RE.test(text) || HEADING_PREFIX_RE.test(text)) {
    throw new Error("Dream unit writer must return plain one-line unit text without list markers");
  }
  return text;
}

function validateSectionPlacement(unit: DreamProposedUnit, sources: DreamMemoryUnit[]) {
  const resident = sources.filter((source) => source.origin === "resident");
  const residentSections = new Set(resident.map((source) => source.section));
  const candidates = sources.filter((source) => source.origin === "fact_candidate");
  const hasStableCandidate = candidates.some((source) => source.temporal === "stable" || source.temporal === "active");

  if (unit.section === "week") {
    if (!unit.date) throw new Error("Dream week unit omitted its date");
  } else if (unit.date) {
    throw new Error("Dream non-week unit unexpectedly included a date");
  }

  if (residentSections.size === 1) {
    const only = [...residentSections][0];
    if (only === "week") {
      const dates = new Set(resident.map((source) => source.date));
      if (dates.size !== 1 || unit.section !== "week" || unit.date !== [...dates][0]) {
        throw new Error("Dream writer moved a week unit outside its source date");
      }
      return;
    }
    if (only === "longterm" && hasStableCandidate
      && (unit.relation === "same_meaning" || unit.relation === "subsumes")) {
      if (unit.section !== "facts") {
        throw new Error("Stable facts must be canonicalized into Facts instead of Longterm");
      }
      return;
    }
    if (unit.section !== only) {
      throw new Error(`Dream writer moved a ${only} unit without a cross-section duplicate source`);
    }
    return;
  }

  if (residentSections.has("facts") && residentSections.has("longterm")
    && (unit.relation === "same_meaning" || unit.relation === "subsumes")) {
    if (unit.section !== "facts") {
      throw new Error("Facts must win over Longterm for the same stable assertion");
    }
    return;
  }

  if (resident.length === 0 && candidates.length > 0) {
    const preferred = hasStableCandidate ? "facts" : candidates[0].section;
    if (unit.section !== preferred) {
      throw new Error(`Dream candidate was placed in ${unit.section} instead of ${preferred}`);
    }
    return;
  }

  if (resident.length > 0 && !residentSections.has(unit.section)) {
    throw new Error("Dream writer moved a unit to a section absent from its resident sources");
  }
}

function renderUnits(units: DreamProposedUnit[], prepared: PreparedDreamUnits): DreamSections {
  const ordered = [...units].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const render = (items: DreamProposedUnit[]) => items.map((unit) => `- ${unit.text}`).join("\n");
  return {
    facts: render(ordered.filter((unit) => unit.section === "facts")),
    today: prepared.preservedToday,
    weekDays: prepared.preservedWeekDays.map((entry) => ({ ...entry })),
    longterm: render(ordered.filter((unit) => unit.section === "longterm")),
  };
}

function similarity(left: string, right: string) {
  const a = normalizeFactText(left);
  const b = normalizeFactText(right);
  if (a === b) return 1;
  return jaccardSimilarity(tokenizeFactText(a), tokenizeFactText(b));
}

function hasDatedOrHistoricalContext(text: string) {
  return /(?:\b(?:19|20)\d{2}(?:-\d{2}-\d{2})?\b|完成|结束|发布|迁移|里程碑|曾经|当时|此前|completed|finished|released|migrated|milestone|previously)/i.test(text);
}

export function validateAndRenderDreamUnitPlan(raw: Record<string, unknown>, prepared: PreparedDreamUnits) {
  if (!Array.isArray(raw.units)) throw new Error("Dream unit writer omitted units[]");
  const known = new Map([...prepared.residentUnits, ...prepared.candidateUnits].map((unit) => [unit.id, unit]));
  const proposedUnits: DreamProposedUnit[] = [];

  for (const [index, item] of (raw.units as Record<string, unknown>[]).entries()) {
    const sourceUnitIds = parseStringArray(item?.sourceUnitIds, "sourceUnitIds");
    if (sourceUnitIds.length === 0) throw new Error("Dream unit writer returned an ungrounded unit");
    const sources = sourceUnitIds.map((id) => {
      const source = known.get(id);
      if (!source) throw new Error(`Dream unit writer referenced unknown source ${id}`);
      if (source.origin === "fact_candidate" && !["keep", "merge"].includes(source.action || "")) {
        throw new Error(`Dream unit writer used non-resident candidate ${id}`);
      }
      return source;
    });
    const section = typeof item?.section === "string" ? item.section as MemoryUnitSection : "" as MemoryUnitSection;
    const relation = typeof item?.relation === "string" ? item.relation as DreamUnitRelation : "" as DreamUnitRelation;
    if (!SECTIONS.has(section) || !RELATIONS.has(relation)) {
      throw new Error("Dream unit writer returned an invalid section or relation");
    }
    if (section === "today" || section === "week") {
      throw new Error("Dream writer may only edit Facts and Longterm");
    }
    if (["same_meaning", "subsumes"].includes(relation) && sourceUnitIds.length < 2) {
      throw new Error(`Dream ${relation} relation requires at least two sources`);
    }
    if (["unchanged", "split", "related_but_distinct", "conflict"].includes(relation)
      && sourceUnitIds.length !== 1) {
      throw new Error(`Dream ${relation} sources must remain separate units`);
    }
    const date = typeof item?.date === "string" ? item.date : undefined;
    if (date) throw new Error("Dream Facts/Longterm unit unexpectedly included a date");
    const proposed: DreamProposedUnit = {
      id: `result:${index}`,
      sourceUnitIds,
      text: validatePlainUnitText(item?.text),
      section,
      ...(date ? { date } : {}),
      relation,
      order: Math.min(...sources.map((source) => source.order), prepared.originalResidentUnits.length + index),
    };
    validateSectionPlacement(proposed, sources);
    proposedUnits.push(proposed);
  }

  const rawRemoved = raw.removedUnits === undefined ? [] : raw.removedUnits;
  if (!Array.isArray(rawRemoved)) throw new Error("Dream unit writer removedUnits must be an array");
  const removedUnits: DreamRemovedUnit[] = [];
  const removedIds = new Set<string>();
  for (const item of rawRemoved as Record<string, unknown>[]) {
    const sourceUnitId = typeof item?.sourceUnitId === "string" ? item.sourceUnitId : "";
    const source = known.get(sourceUnitId);
    if (!source || source.origin !== "resident" || removedIds.has(sourceUnitId)) {
      throw new Error("Dream unit writer returned an unknown or duplicate removed source");
    }
    const reason = item?.reason === "closed" || item?.reason === "obsolete" ? item.reason : null;
    if (!reason) throw new Error("Dream unit writer returned an invalid removal reason");
    const supportingCandidateUnitIds = parseStringArray(
      item?.supportingCandidateUnitIds,
      "supportingCandidateUnitIds",
    );
    if (supportingCandidateUnitIds.length === 0) {
      throw new Error("Dream removal requires an evidence-backed candidate");
    }
    for (const id of supportingCandidateUnitIds) {
      const candidate = known.get(id);
      if (!candidate || candidate.origin !== "fact_candidate" || candidate.action !== "forget") {
        throw new Error("Dream removal requires a candidate classified forget");
      }
      if (candidate.temporal !== "closed" && candidate.temporal !== "obsolete") {
        throw new Error("Dream removal requires a closed or obsolete candidate");
      }
      if (candidate.temporal !== reason) {
        throw new Error("Dream removal reason must match its supporting candidate");
      }
      if (similarity(source.text, candidate.text) < 0.45) {
        throw new Error("Dream removal evidence does not support the resident unit");
      }
    }
    removedIds.add(sourceUnitId);
    removedUnits.push({ sourceUnitId, supportingCandidateUnitIds, reason });
  }

  const coveredResident = new Set(proposedUnits.flatMap((unit) => unit.sourceUnitIds));
  for (const source of prepared.residentUnits) {
    if (!coveredResident.has(source.id) && !removedIds.has(source.id)) {
      throw new Error(`Dream unit writer omitted resident source ${source.id}`);
    }
    if (coveredResident.has(source.id) && removedIds.has(source.id)) {
      throw new Error(`Dream unit writer both retained and removed source ${source.id}`);
    }
  }
  for (const source of prepared.residentUnits) {
    if (source.section !== "longterm" || !hasDatedOrHistoricalContext(source.text)) continue;
    const uses = proposedUnits.filter((unit) => unit.sourceUnitIds.includes(source.id));
    if (uses.some((unit) => unit.section === "facts")
      && !uses.some((unit) => unit.section === "longterm")) {
      throw new Error("Dream writer moved unique dated or historical Longterm context into Facts");
    }
  }
  const requiredCandidates = prepared.candidateUnits.filter((unit) => unit.action === "keep" || unit.action === "merge");
  for (const candidate of requiredCandidates) {
    if (!proposedUnits.some((unit) => unit.sourceUnitIds.includes(candidate.id))) {
      throw new Error(`Dream unit writer omitted required candidate ${candidate.id}`);
    }
  }

  const outputUses = new Map<string, DreamProposedUnit[]>();
  for (const unit of proposedUnits) {
    for (const sourceId of unit.sourceUnitIds) {
      const uses = outputUses.get(sourceId) || [];
      uses.push(unit);
      outputUses.set(sourceId, uses);
    }
  }
  for (const uses of outputUses.values()) {
    if (uses.length > 1 && !uses.some((unit) => unit.relation === "split")) {
      throw new Error("Dream unit writer duplicated a source without declaring a split");
    }
  }

  const operations: DreamUnitOperation[] = [...prepared.exactDuplicateOperations];
  for (const unit of proposedUnits) {
    if (unit.relation === "same_meaning" || unit.relation === "subsumes") {
      operations.push({ kind: "merge", sourceUnitIds: unit.sourceUnitIds, resultUnitIds: [unit.id] });
    } else if (unit.relation === "split") {
      operations.push({ kind: "split", sourceUnitIds: unit.sourceUnitIds, resultUnitIds: [unit.id] });
    } else if (unit.relation === "unchanged") {
      const source = known.get(unit.sourceUnitIds[0]);
      if (unit.sourceUnitIds.length !== 1 || !source || normalizeFactText(source.text) !== normalizeFactText(unit.text)) {
        operations.push({ kind: "rewrite", sourceUnitIds: unit.sourceUnitIds, resultUnitIds: [unit.id] });
      }
    }
  }
  if (removedUnits.length > 0) {
    operations.push({ kind: "forget", sourceUnitIds: removedUnits.map((unit) => unit.sourceUnitId), resultUnitIds: [] });
  }

  const sections = renderUnits(proposedUnits, prepared);
  let mergedCount = prepared.exactDuplicateOperations
    .reduce((sum, operation) => sum + operation.removedUnitIds.length, 0);
  for (const operation of operations) {
    if (operation.kind === "merge") {
      mergedCount += Math.max(0, operation.sourceUnitIds.length - 1);
    }
  }
  return {
    ...prepared,
    proposedUnits,
    removedUnits,
    operations,
    sections,
    mergedCount,
    forgottenCount: removedUnits.length,
  } satisfies DreamUnitPlan;
}
