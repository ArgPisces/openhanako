import { describe, expect, it } from "vitest";
import { buildFactEvidence } from "../lib/memory/dream/evidence.ts";
import {
  aggregateFactDecisionsByGroup,
  decideFactActions,
  resolveDreamPolicy,
} from "../lib/memory/dream/policy.ts";

const NOW = "2026-08-08T12:00:00.000Z";

function fact(id, text, overrides = {}) {
  return {
    id,
    fact: text,
    tags: [],
    time: "2026-01-01T10:00:00.000Z",
    session_id: `session-${id}`,
    created_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function decisionsFor(facts, evidenceOptions = {}, policyOptions = {}) {
  const report = buildFactEvidence(facts, { now: NOW, ...evidenceOptions });
  return decideFactActions(report.facts, policyOptions);
}

describe("Memory Dream hard-threshold policy", () => {
  it("never forgets protected or pinned facts", () => {
    const decisions = decisionsFor([
      fact(1, "Old protected preference", { protected: true }),
      fact(2, "Old pinned preference", { pinned: true }),
    ]);

    expect(decisions.map((item) => ({ id: item.factId, action: item.action, allowed: item.allowedActions }))).toEqual([
      { id: 1, action: "keep", allowed: ["keep"] },
      { id: 2, action: "keep", allowed: ["keep"] },
    ]);
    expect(decisions[0].reasons[0].code).toBe("protected");
    expect(decisions[1].reasons[0].code).toBe("pinned");
  });

  it("keeps a recent singleton inside the fixed recency window", () => {
    const [decision] = decisionsFor([
      fact(1, "A new preference", { time: "2026-08-01T10:00:00.000Z" }),
    ]);

    expect(decision.action).toBe("keep");
    expect(decision.reasons).toContainEqual(expect.objectContaining({ code: "recent", threshold: 45 }));
  });

  it("forgets only an old, sparse, domain-peripheral singleton", () => {
    const [decision] = decisionsFor([
      fact(1, "A one-off restaurant receipt", { tags: ["restaurant"] }),
    ], { domainTags: ["engineering", "product"] });

    expect(decision.action).toBe("forget");
    expect(decision.allowedActions).toEqual(["forget"]);
    expect(decision.reasons.map((item) => item.code)).toEqual(["old", "sparse", "peripheral"]);
    expect(decision.evidence).toMatchObject({
      occurrenceCount: 1,
      distinctSessionCount: 1,
      distinctDayCount: 1,
      domainTagOverlapCount: 0,
    });
  });

  it("keeps old facts with cross-session/cross-day or domain evidence", () => {
    const decisions = decisionsFor([
      fact(1, "The project uses TypeScript", { session_id: "a", time: "2026-01-01T10:00:00.000Z" }),
      fact(2, "The project uses TypeScript.", { session_id: "b", time: "2026-01-03T10:00:00.000Z" }),
      fact(3, "The release process is documented", { tags: ["engineering"] }),
    ], { domainTags: ["engineering"] });

    const canonical = decisions.find((item) => item.factId === 1);
    const domainRelevant = decisions.find((item) => item.factId === 3);
    expect(canonical.action).toBe("keep");
    expect(canonical.reasons.map((item) => item.code)).toEqual([
      "duplicate_canonical",
      "multi_session",
      "multi_day",
    ]);
    expect(domainRelevant.action).toBe("keep");
    expect(domainRelevant.reasons).toContainEqual(expect.objectContaining({ code: "domain_overlap" }));
  });

  it("marks gray-zone facts for review and exposes only keep/forget to a reviewer", () => {
    const [decision] = decisionsFor([
      fact(1, "A fact with no timestamp", { time: null, created_at: null, session_id: null }),
    ]);

    expect(decision.action).toBe("review");
    expect(decision.allowedActions).toEqual(["keep", "forget"]);
    expect(decision.reasons.map((item) => item.code)).toEqual(["unknown_age", "insufficient_evidence"]);
  });

  it("selects a canonical merge target and can aggregate to one stable group decision", () => {
    const decisions = decisionsFor([
      fact(1, "User prefers dark mode", { time: "2026-07-01T10:00:00.000Z", session_id: "a" }),
      fact(2, "User prefers the dark mode", { time: "2026-07-02T10:00:00.000Z", session_id: "b" }),
    ]);

    const merged = decisions.find((item) => item.factId !== item.evidence.canonicalFactId);
    expect(merged).toMatchObject({
      action: "merge",
      allowedActions: ["merge"],
      sourceFactIds: [1, 2],
    });
    expect(merged.mergeIntoFactId).toBe(merged.evidence.canonicalFactId);

    const aggregated = aggregateFactDecisionsByGroup(decisions);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      canonicalFact: "User prefers the dark mode",
      sourceFactIds: [1, 2],
      action: "keep",
      allowedActions: ["keep"],
    });
  });

  it("returns identical decisions for the same evidence and rejects contradictory age thresholds", () => {
    const facts = [
      fact(9, "Old peripheral detail"),
      fact(3, "Recent detail", { time: "2026-08-07T10:00:00.000Z" }),
    ];
    const first = decisionsFor(facts);
    const second = decisionsFor([facts[1], facts[0]]);

    expect(first).toEqual(second);
    expect(() => resolveDreamPolicy({ recentDays: 200, forgetAfterDays: 100 })).toThrow(
      "recentDays cannot exceed forgetAfterDays",
    );
  });
});
