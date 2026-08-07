import type {
  DreamPolicyOptions,
  FactDecision,
  FactDecisionReason,
  FactEvidence,
  ResolvedDreamPolicyOptions,
} from "./types.ts";
import { factIdKey } from "./evidence.ts";

export const DEFAULT_DREAM_POLICY: Readonly<ResolvedDreamPolicyOptions> = Object.freeze({
  recentDays: 45,
  forgetAfterDays: 180,
  keepMinOccurrences: 3,
  keepMinDistinctSessions: 2,
  keepMinDistinctDays: 2,
  keepMinDomainTagOverlap: 1,
  forgetMaxOccurrences: 1,
  forgetMaxDistinctSessions: 1,
  forgetMaxDistinctDays: 1,
  forgetMaxDomainTagOverlap: 0,
});

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function resolveDreamPolicy(options: DreamPolicyOptions = {}): ResolvedDreamPolicyOptions {
  const resolved = {
    recentDays: nonNegativeInteger(options.recentDays, DEFAULT_DREAM_POLICY.recentDays),
    forgetAfterDays: nonNegativeInteger(options.forgetAfterDays, DEFAULT_DREAM_POLICY.forgetAfterDays),
    keepMinOccurrences: nonNegativeInteger(options.keepMinOccurrences, DEFAULT_DREAM_POLICY.keepMinOccurrences),
    keepMinDistinctSessions: nonNegativeInteger(
      options.keepMinDistinctSessions,
      DEFAULT_DREAM_POLICY.keepMinDistinctSessions,
    ),
    keepMinDistinctDays: nonNegativeInteger(options.keepMinDistinctDays, DEFAULT_DREAM_POLICY.keepMinDistinctDays),
    keepMinDomainTagOverlap: nonNegativeInteger(
      options.keepMinDomainTagOverlap,
      DEFAULT_DREAM_POLICY.keepMinDomainTagOverlap,
    ),
    forgetMaxOccurrences: nonNegativeInteger(
      options.forgetMaxOccurrences,
      DEFAULT_DREAM_POLICY.forgetMaxOccurrences,
    ),
    forgetMaxDistinctSessions: nonNegativeInteger(
      options.forgetMaxDistinctSessions,
      DEFAULT_DREAM_POLICY.forgetMaxDistinctSessions,
    ),
    forgetMaxDistinctDays: nonNegativeInteger(
      options.forgetMaxDistinctDays,
      DEFAULT_DREAM_POLICY.forgetMaxDistinctDays,
    ),
    forgetMaxDomainTagOverlap: nonNegativeInteger(
      options.forgetMaxDomainTagOverlap,
      DEFAULT_DREAM_POLICY.forgetMaxDomainTagOverlap,
    ),
  };

  if (resolved.recentDays > resolved.forgetAfterDays) {
    throw new Error("Dream policy recentDays cannot exceed forgetAfterDays");
  }
  return resolved;
}

function reason(
  code: FactDecisionReason["code"],
  message: string,
  value?: FactDecisionReason["value"],
  threshold?: number,
): FactDecisionReason {
  return { code, message, ...(value !== undefined ? { value } : {}), ...(threshold !== undefined ? { threshold } : {}) };
}

function decideOne(evidence: FactEvidence, policy: ResolvedDreamPolicyOptions): FactDecision {
  const shared = {
    factId: evidence.factId,
    groupId: evidence.duplicateGroupId ?? `fact:${factIdKey(evidence.canonicalFactId)}`,
    canonicalFact: evidence.canonicalText,
    sourceFactIds: evidence.sourceFactIds,
    evidence,
  };

  if (evidence.isProtected) {
    return {
      ...shared,
      action: "keep",
      allowedActions: ["keep"],
      reasons: [reason("protected", "The fact is explicitly protected and cannot be removed.", true)],
    };
  }

  if (evidence.isPinned) {
    return {
      ...shared,
      action: "keep",
      allowedActions: ["keep"],
      reasons: [reason("pinned", "The fact is explicitly pinned and cannot be removed.", true)],
    };
  }

  if (factIdKey(evidence.factId) !== factIdKey(evidence.canonicalFactId)) {
    const code = evidence.duplicateKind === "exact" ? "exact_duplicate" : "near_duplicate";
    return {
      ...shared,
      action: "merge",
      allowedActions: ["merge"],
      mergeIntoFactId: evidence.canonicalFactId,
      reasons: [reason(
        code,
        `The fact belongs to a ${evidence.duplicateKind} duplicate group and has a deterministic canonical fact.`,
        evidence.similarityToCanonical,
      )],
    };
  }

  const contextReasons: FactDecisionReason[] = [];
  if (evidence.duplicateGroupId) {
    contextReasons.push(reason(
      "duplicate_canonical",
      "This fact is the canonical representative of a duplicate group.",
      evidence.occurrenceCount,
    ));
  }
  const keepReasons: FactDecisionReason[] = [];
  if (evidence.ageDays !== null && evidence.ageDays <= policy.recentDays) {
    keepReasons.push(reason(
      "recent",
      "The most recent occurrence is inside the protected recency window.",
      evidence.ageDays,
      policy.recentDays,
    ));
  }
  if (evidence.occurrenceCount >= policy.keepMinOccurrences) {
    keepReasons.push(reason(
      "repeated",
      "The fact has enough observed occurrences to retain.",
      evidence.occurrenceCount,
      policy.keepMinOccurrences,
    ));
  }
  if (evidence.distinctSessionCount >= policy.keepMinDistinctSessions) {
    keepReasons.push(reason(
      "multi_session",
      "The fact appears across enough distinct sessions to retain.",
      evidence.distinctSessionCount,
      policy.keepMinDistinctSessions,
    ));
  }
  if (evidence.distinctDayCount >= policy.keepMinDistinctDays) {
    keepReasons.push(reason(
      "multi_day",
      "The fact appears across enough distinct days to retain.",
      evidence.distinctDayCount,
      policy.keepMinDistinctDays,
    ));
  }
  if (evidence.domainTagOverlapCount >= policy.keepMinDomainTagOverlap) {
    keepReasons.push(reason(
      "domain_overlap",
      "The fact's tags overlap the configured agent/domain tags.",
      evidence.domainTagOverlapCount,
      policy.keepMinDomainTagOverlap,
    ));
  }

  if (keepReasons.length > 0) {
    return {
      ...shared,
      action: "keep",
      allowedActions: ["keep"],
      reasons: [...contextReasons, ...keepReasons],
    };
  }

  const isOld = evidence.ageDays !== null && evidence.ageDays >= policy.forgetAfterDays;
  const isSparse = evidence.occurrenceCount <= policy.forgetMaxOccurrences
    && evidence.distinctSessionCount <= policy.forgetMaxDistinctSessions
    && evidence.distinctDayCount <= policy.forgetMaxDistinctDays;
  const isPeripheral = evidence.domainTagOverlapCount <= policy.forgetMaxDomainTagOverlap;

  if (isOld && isSparse && isPeripheral) {
    return {
      ...shared,
      action: "forget",
      allowedActions: ["forget"],
      reasons: [
        ...contextReasons,
        reason("old", "The most recent occurrence is beyond the forget age threshold.", evidence.ageDays, policy.forgetAfterDays),
        reason("sparse", "Occurrences are limited to the configured sparse-evidence bounds.", evidence.occurrenceCount, policy.forgetMaxOccurrences),
        reason("peripheral", "No sufficient agent/domain tag overlap was observed.", evidence.domainTagOverlapCount, policy.forgetMaxDomainTagOverlap),
      ],
    };
  }

  const reviewReasons: FactDecisionReason[] = [];
  if (evidence.ageDays === null) {
    reviewReasons.push(reason("unknown_age", "The fact has no parseable occurrence date, so age-based forgetting is unsafe."));
  }
  reviewReasons.push(reason(
    "insufficient_evidence",
    "The fact meets neither a deterministic keep rule nor every required forget rule.",
  ));
  return {
    ...shared,
    action: "review",
    allowedActions: ["keep", "forget"],
    reasons: [...contextReasons, ...reviewReasons],
  };
}

/** Apply hard, explainable thresholds to previously computed evidence. */
export function decideFactActions(
  evidence: readonly FactEvidence[],
  options: DreamPolicyOptions = {},
): FactDecision[] {
  const policy = resolveDreamPolicy(options);
  return [...evidence]
    .sort((left, right) => factIdKey(left.factId).localeCompare(factIdKey(right.factId), "en"))
    .map((item) => decideOne(item, policy));
}

/**
 * Collapse per-source decisions to one canonical decision per group. This is
 * the form consumed by a writer: duplicate source IDs remain attached as
 * evidence, while protected/pinned members still force a keep decision.
 */
export function aggregateFactDecisionsByGroup(
  decisions: readonly FactDecision[],
): FactDecision[] {
  const groups = new Map<string, FactDecision[]>();
  for (const decision of decisions) {
    const members = groups.get(decision.groupId) || [];
    members.push(decision);
    groups.set(decision.groupId, members);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, members]) => {
      const selected = members.find((item) => item.evidence.isProtected)
        ?? members.find((item) => item.evidence.isPinned)
        ?? members.find((item) => factIdKey(item.factId) === factIdKey(item.evidence.canonicalFactId))
        ?? members[0];
      const sourceFactIds = [...new Map(
        members.flatMap((item) => item.sourceFactIds).map((id) => [factIdKey(id), id] as const),
      ).values()].sort((left, right) => factIdKey(left).localeCompare(factIdKey(right), "en"));
      return { ...selected, sourceFactIds };
    });
}
