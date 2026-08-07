export type FactId = number | string;

/**
 * The stable fields exposed by FactStore, plus optional policy flags supplied
 * by a caller. Dream never mutates these source records.
 */
export interface FactRecord {
  id: FactId;
  fact: string;
  tags?: readonly string[];
  time?: string | null;
  session_id?: string | null;
  created_at?: string | null;
  pinned?: boolean;
  protected?: boolean;
}

export type DuplicateKind = "exact" | "near";

export interface DuplicateGroupMember {
  factId: FactId;
  similarityToCanonical: number;
}

export interface DuplicateGroup {
  id: string;
  kind: DuplicateKind;
  canonicalFactId: FactId;
  members: readonly DuplicateGroupMember[];
}

export interface DuplicateDetectionOptions {
  /** Jaccard threshold in the inclusive range [0, 1]. */
  nearDuplicateThreshold?: number;
  /** Near matching is disabled for tiny token sets to avoid generic collisions. */
  minimumNearDuplicateTokens?: number;
  protectedFactIds?: readonly FactId[] | ReadonlySet<FactId>;
  pinnedFactIds?: readonly FactId[] | ReadonlySet<FactId>;
}

export interface FactEvidenceOptions extends DuplicateDetectionOptions {
  now?: Date | string | number;
  /** Agent/domain tags against which each fact's tags are compared. */
  domainTags?: readonly string[];
}

/**
 * Observable signals only. Policy labels such as "important" deliberately do
 * not appear here, so the same evidence can be audited under another policy.
 */
export interface FactEvidence {
  factId: FactId;
  normalizedText: string;
  canonicalText: string;
  tokens: readonly string[];
  sourceFactIds: readonly FactId[];
  occurrenceCount: number;
  distinctSessionCount: number;
  distinctDayCount: number;
  observedTags: readonly string[];
  domainTagOverlap: readonly string[];
  domainTagOverlapCount: number;
  /** overlap count divided by configured domain tag count; zero when none are configured */
  domainTagOverlapRatio: number;
  mostRecentAt: string | null;
  ageDays: number | null;
  isProtected: boolean;
  isPinned: boolean;
  duplicateGroupId: string | null;
  duplicateKind: DuplicateKind | null;
  canonicalFactId: FactId;
  similarityToCanonical: number;
}

export interface DreamEvidenceReport {
  facts: readonly FactEvidence[];
  duplicateGroups: readonly DuplicateGroup[];
}

export type FactDecisionAction = "keep" | "merge" | "forget" | "review";

export type FactDecisionReasonCode =
  | "protected"
  | "pinned"
  | "duplicate_canonical"
  | "exact_duplicate"
  | "near_duplicate"
  | "recent"
  | "repeated"
  | "multi_session"
  | "multi_day"
  | "domain_overlap"
  | "old"
  | "sparse"
  | "peripheral"
  | "unknown_age"
  | "insufficient_evidence";

export interface FactDecisionReason {
  code: FactDecisionReasonCode;
  message: string;
  value?: string | number | boolean | null;
  threshold?: number;
}

export interface FactDecision {
  factId: FactId;
  groupId: string;
  canonicalFact: string;
  sourceFactIds: readonly FactId[];
  action: FactDecisionAction;
  /** The only actions a later review/LLM stage may choose without violating policy. */
  allowedActions: readonly FactDecisionAction[];
  mergeIntoFactId?: FactId;
  reasons: readonly FactDecisionReason[];
  evidence: FactEvidence;
}

/**
 * Every threshold is explicit and independently testable. A caller may tune
 * values, but cannot bypass the protected/pinned safety rules.
 */
export interface DreamPolicyOptions {
  recentDays?: number;
  forgetAfterDays?: number;
  keepMinOccurrences?: number;
  keepMinDistinctSessions?: number;
  keepMinDistinctDays?: number;
  keepMinDomainTagOverlap?: number;
  forgetMaxOccurrences?: number;
  forgetMaxDistinctSessions?: number;
  forgetMaxDistinctDays?: number;
  forgetMaxDomainTagOverlap?: number;
}

export interface ResolvedDreamPolicyOptions {
  recentDays: number;
  forgetAfterDays: number;
  keepMinOccurrences: number;
  keepMinDistinctSessions: number;
  keepMinDistinctDays: number;
  keepMinDomainTagOverlap: number;
  forgetMaxOccurrences: number;
  forgetMaxDistinctSessions: number;
  forgetMaxDistinctDays: number;
  forgetMaxDomainTagOverlap: number;
}
