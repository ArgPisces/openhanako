import type {
  DreamEvidenceReport,
  DuplicateDetectionOptions,
  DuplicateGroup,
  FactEvidence,
  FactEvidenceOptions,
  FactId,
  FactRecord,
} from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.77;
const DEFAULT_MINIMUM_NEAR_DUPLICATE_TOKENS = 4;

interface ExactCluster {
  representative: FactRecord;
  normalizedText: string;
  tokens: readonly string[];
  members: FactRecord[];
}

interface WorkingGroup {
  representative: FactRecord;
  representativeTokens: readonly string[];
  clusters: ExactCluster[];
}

export function factIdKey(id: FactId): string {
  return `${typeof id}:${String(id)}`;
}

/** Normalize spelling/case/punctuation without rewriting the underlying fact. */
export function normalizeFactText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Latin-like text is tokenized by word. CJK runs additionally receive
 * character and bigram tokens, allowing near matching without a segmenter.
 */
export function tokenizeFactText(value: unknown): string[] {
  const normalized = normalizeFactText(value);
  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const word of normalized.match(/[\p{L}\p{N}]+/gu) || []) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(word)) {
      const chars = Array.from(word);
      for (const char of chars) tokens.add(`c:${char}`);
      for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.add(`b:${chars[index]}${chars[index + 1]}`);
      }
    } else {
      tokens.add(`w:${word}`);
    }
  }
  return [...tokens].sort();
}

export function jaccardSimilarity(
  left: readonly string[] | ReadonlySet<string>,
  right: readonly string[] | ReadonlySet<string>,
): number {
  const leftSet = left instanceof Set ? left : new Set(left);
  const rightSet = right instanceof Set ? right : new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function toIdKeySet(ids?: readonly FactId[] | ReadonlySet<FactId>): Set<string> {
  if (!ids) return new Set();
  return new Set([...ids].map(factIdKey));
}

function normalizedTags(record: FactRecord): string[] {
  return [...new Set((record.tags || []).map(normalizeFactText).filter(Boolean))].sort();
}

function timestampOf(record: FactRecord): number | null {
  for (const value of [record.time, record.created_at]) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function compareFactIds(left: FactId, right: FactId): number {
  return factIdKey(left).localeCompare(factIdKey(right), "en");
}

function compareCanonicalCandidates(
  left: FactRecord,
  right: FactRecord,
  protectedIds: ReadonlySet<string>,
  pinnedIds: ReadonlySet<string>,
): number {
  const leftProtected = left.protected === true || protectedIds.has(factIdKey(left.id));
  const rightProtected = right.protected === true || protectedIds.has(factIdKey(right.id));
  if (leftProtected !== rightProtected) return leftProtected ? -1 : 1;

  const leftPinned = left.pinned === true || pinnedIds.has(factIdKey(left.id));
  const rightPinned = right.pinned === true || pinnedIds.has(factIdKey(right.id));
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

  const tagDelta = normalizedTags(right).length - normalizedTags(left).length;
  if (tagDelta !== 0) return tagDelta;

  const lengthDelta = normalizeFactText(right.fact).length - normalizeFactText(left.fact).length;
  if (lengthDelta !== 0) return lengthDelta;

  const leftTimestamp = timestampOf(left);
  const rightTimestamp = timestampOf(right);
  if (leftTimestamp !== rightTimestamp) {
    if (leftTimestamp === null) return 1;
    if (rightTimestamp === null) return -1;
    return leftTimestamp - rightTimestamp;
  }
  return compareFactIds(left.id, right.id);
}

function clampUnitInterval(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function buildExactClusters(
  facts: readonly FactRecord[],
  protectedIds: ReadonlySet<string>,
  pinnedIds: ReadonlySet<string>,
): ExactCluster[] {
  const byText = new Map<string, FactRecord[]>();
  for (const fact of facts) {
    const normalized = normalizeFactText(fact.fact);
    // Empty facts do not provide enough evidence to deduplicate each other.
    const key = normalized || `__empty__:${factIdKey(fact.id)}`;
    const members = byText.get(key) || [];
    members.push(fact);
    byText.set(key, members);
  }

  const clusters: ExactCluster[] = [];
  for (const members of byText.values()) {
    members.sort((left, right) => compareCanonicalCandidates(left, right, protectedIds, pinnedIds));
    const representative = members[0];
    const normalizedText = normalizeFactText(representative.fact);
    clusters.push({
      representative,
      normalizedText,
      tokens: tokenizeFactText(normalizedText),
      members,
    });
  }

  return clusters.sort((left, right) =>
    compareCanonicalCandidates(left.representative, right.representative, protectedIds, pinnedIds));
}

/**
 * Form duplicate groups deterministically. Exact duplicates are grouped first;
 * exact clusters are then attached to the most similar preferred canonical.
 * This avoids order-dependent transitive chains where A≈B and B≈C but A≉C.
 */
export function buildDuplicateGroups(
  facts: readonly FactRecord[],
  options: DuplicateDetectionOptions = {},
): DuplicateGroup[] {
  const threshold = clampUnitInterval(
    options.nearDuplicateThreshold,
    DEFAULT_NEAR_DUPLICATE_THRESHOLD,
  );
  const minimumTokens = positiveInteger(
    options.minimumNearDuplicateTokens,
    DEFAULT_MINIMUM_NEAR_DUPLICATE_TOKENS,
  );
  const protectedIds = toIdKeySet(options.protectedFactIds);
  const pinnedIds = toIdKeySet(options.pinnedFactIds);
  const exactClusters = buildExactClusters(facts, protectedIds, pinnedIds);
  const workingGroups: WorkingGroup[] = [];
  const groupIndexesByToken = new Map<string, number[]>();

  for (const cluster of exactClusters) {
    let bestGroup: WorkingGroup | null = null;
    let bestSimilarity = -1;

    if (cluster.tokens.length >= minimumTokens) {
      const candidateIndexes = threshold === 0
        ? new Set(workingGroups.map((_, index) => index))
        : new Set(cluster.tokens.flatMap((token) => groupIndexesByToken.get(token) || []));
      for (const groupIndex of candidateIndexes) {
        const group = workingGroups[groupIndex];
        const representativeTokens = group.representativeTokens;
        if (representativeTokens.length < minimumTokens) continue;
        const maximumPossibleSimilarity = Math.min(cluster.tokens.length, representativeTokens.length)
          / Math.max(cluster.tokens.length, representativeTokens.length);
        if (maximumPossibleSimilarity < threshold) continue;
        const similarity = jaccardSimilarity(cluster.tokens, representativeTokens);
        if (similarity < threshold) continue;
        if (
          similarity > bestSimilarity
          || (similarity === bestSimilarity
            && compareFactIds(group.representative.id, bestGroup?.representative.id ?? cluster.representative.id) < 0)
        ) {
          bestGroup = group;
          bestSimilarity = similarity;
        }
      }
    }

    if (bestGroup) {
      bestGroup.clusters.push(cluster);
    } else {
      const groupIndex = workingGroups.length;
      workingGroups.push({
        representative: cluster.representative,
        representativeTokens: cluster.tokens,
        clusters: [cluster],
      });
      for (const token of cluster.tokens) {
        const indexes = groupIndexesByToken.get(token) || [];
        indexes.push(groupIndex);
        groupIndexesByToken.set(token, indexes);
      }
    }
  }

  const duplicateGroups = workingGroups
    .map((group): DuplicateGroup | null => {
      const members = group.clusters.flatMap((cluster) => cluster.members);
      if (members.length < 2) return null;
      const canonical = [...members].sort((left, right) =>
        compareCanonicalCandidates(left, right, protectedIds, pinnedIds))[0];
      const canonicalText = normalizeFactText(canonical.fact);
      const canonicalTokens = tokenizeFactText(canonicalText);
      const kind = group.clusters.length === 1 ? "exact" : "near";

      return {
        id: `duplicate:${factIdKey(canonical.id)}`,
        kind,
        canonicalFactId: canonical.id,
        members: [...members]
          .sort((left, right) => compareFactIds(left.id, right.id))
          .map((member) => ({
            factId: member.id,
            similarityToCanonical: normalizeFactText(member.fact) === canonicalText
              ? 1
              : jaccardSimilarity(tokenizeFactText(member.fact), canonicalTokens),
          })),
      };
    })
    .filter((group): group is DuplicateGroup => group !== null);

  return duplicateGroups.sort((left, right) => compareFactIds(left.canonicalFactId, right.canonicalFactId));
}

function parseNow(value: FactEvidenceOptions["now"]): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value ?? Date.now()).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Dream evidence requires a valid now value");
  return timestamp;
}

function dayKey(record: FactRecord): string | null {
  for (const value of [record.time, record.created_at]) {
    if (!value) continue;
    const explicitDay = String(value).match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];
    if (explicitDay) return explicitDay;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString().slice(0, 10);
  }
  return null;
}

function newestTimestamp(records: readonly FactRecord[]): number | null {
  let newest: number | null = null;
  for (const record of records) {
    const timestamp = timestampOf(record);
    if (timestamp === null) continue;
    if (newest === null || timestamp > newest) newest = timestamp;
  }
  return newest;
}

/** Build auditable metrics for every source fact without assigning an action. */
export function buildFactEvidence(
  facts: readonly FactRecord[],
  options: FactEvidenceOptions = {},
): DreamEvidenceReport {
  const now = parseNow(options.now);
  const protectedIds = toIdKeySet(options.protectedFactIds);
  const pinnedIds = toIdKeySet(options.pinnedFactIds);
  const domainTags = new Set((options.domainTags || []).map(normalizeFactText).filter(Boolean));
  const duplicateGroups = buildDuplicateGroups(facts, options);
  const factById = new Map(facts.map((fact) => [factIdKey(fact.id), fact]));
  const duplicateByFact = new Map<string, DuplicateGroup>();
  for (const group of duplicateGroups) {
    for (const member of group.members) duplicateByFact.set(factIdKey(member.factId), group);
  }

  const evidence = facts.map((fact): FactEvidence => {
    const group = duplicateByFact.get(factIdKey(fact.id)) || null;
    const sourceFacts = group
      ? group.members.map((member) => factById.get(factIdKey(member.factId))).filter((item): item is FactRecord => Boolean(item))
      : [fact];
    const sessions = new Set(sourceFacts.map((item) => item.session_id?.trim()).filter(Boolean));
    const days = new Set(sourceFacts.map(dayKey).filter((day): day is string => Boolean(day)));
    const observedTags = [...new Set(sourceFacts.flatMap(normalizedTags))].sort();
    const domainTagOverlap = observedTags.filter((tag) => domainTags.has(tag));
    const newest = newestTimestamp(sourceFacts);
    const groupMember = group?.members.find((member) => factIdKey(member.factId) === factIdKey(fact.id));
    const canonicalFact = factById.get(factIdKey(group?.canonicalFactId ?? fact.id)) || fact;

    return {
      factId: fact.id,
      normalizedText: normalizeFactText(fact.fact),
      canonicalText: canonicalFact.fact,
      tokens: tokenizeFactText(fact.fact),
      sourceFactIds: sourceFacts.map((item) => item.id).sort(compareFactIds),
      occurrenceCount: sourceFacts.length,
      distinctSessionCount: sessions.size,
      distinctDayCount: days.size,
      observedTags,
      domainTagOverlap,
      domainTagOverlapCount: domainTagOverlap.length,
      domainTagOverlapRatio: domainTags.size === 0 ? 0 : domainTagOverlap.length / domainTags.size,
      mostRecentAt: newest === null ? null : new Date(newest).toISOString(),
      ageDays: newest === null ? null : Math.max(0, Math.floor((now - newest) / DAY_MS)),
      isProtected: fact.protected === true || protectedIds.has(factIdKey(fact.id)),
      isPinned: fact.pinned === true || pinnedIds.has(factIdKey(fact.id)),
      duplicateGroupId: group?.id ?? null,
      duplicateKind: group?.kind ?? null,
      canonicalFactId: group?.canonicalFactId ?? fact.id,
      similarityToCanonical: groupMember?.similarityToCanonical ?? 1,
    };
  });

  evidence.sort((left, right) => compareFactIds(left.factId, right.factId));
  return { facts: evidence, duplicateGroups };
}
