import { describe, expect, it } from "vitest";
import {
  buildDuplicateGroups,
  buildFactEvidence,
  jaccardSimilarity,
  normalizeFactText,
  tokenizeFactText,
} from "../lib/memory/dream/evidence.ts";

const NOW = "2026-08-08T12:00:00.000Z";

function fact(id, text, overrides = {}) {
  return {
    id,
    fact: text,
    tags: [],
    time: "2026-08-01T10:00:00.000Z",
    session_id: `session-${id}`,
    created_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("Memory Dream deterministic evidence", () => {
  it("normalizes punctuation/case and groups exact duplicates", () => {
    const facts = [
      fact(1, "User Prefers TypeScript."),
      fact(2, "  user prefers typescript！  ", { time: "2026-08-02T10:00:00.000Z" }),
      fact(3, "User prefers Python."),
    ];

    expect(normalizeFactText(facts[0].fact)).toBe("user prefers typescript");
    expect(normalizeFactText(facts[1].fact)).toBe("user prefers typescript");
    expect(buildDuplicateGroups(facts)).toEqual([
      {
        id: "duplicate:number:1",
        kind: "exact",
        canonicalFactId: 1,
        members: [
          { factId: 1, similarityToCanonical: 1 },
          { factId: 2, similarityToCanonical: 1 },
        ],
      },
    ]);
  });

  it("groups conservative near duplicates without merging unrelated facts", () => {
    const facts = [
      fact(1, "User prefers dark mode"),
      fact(2, "User prefers the dark mode", { time: "2026-08-02T10:00:00.000Z" }),
      fact(3, "User prefers light backgrounds"),
      fact(4, "用户喜欢深色模式"),
      fact(5, "用户很喜欢深色模式", { time: "2026-08-02T10:00:00.000Z" }),
    ];

    expect(jaccardSimilarity(
      tokenizeFactText(facts[0].fact),
      tokenizeFactText(facts[1].fact),
    )).toBeCloseTo(0.8);

    const groups = buildDuplicateGroups(facts);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.members.map((member) => member.factId))).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(groups.every((group) => group.kind === "near")).toBe(true);
  });

  it("counts occurrences, distinct sessions, distinct days, domain overlap, and recency", () => {
    const facts = [
      fact(1, "The project uses TypeScript", {
        tags: ["engineering", "typescript"],
        time: "2026-07-01T10:00:00.000Z",
        session_id: "session-a",
      }),
      fact(2, "The project uses TypeScript.", {
        tags: ["Engineering"],
        time: "2026-07-02T11:00:00.000Z",
        session_id: "session-b",
      }),
      fact(3, "THE PROJECT USES TYPESCRIPT!", {
        tags: ["typescript"],
        time: "2026-07-02T12:00:00.000Z",
        session_id: "session-b",
      }),
    ];

    const report = buildFactEvidence(facts, {
      now: NOW,
      domainTags: ["engineering", "product"],
    });
    const evidence = report.facts.find((item) => item.factId === 1);

    expect(evidence).toMatchObject({
      sourceFactIds: [1, 2, 3],
      occurrenceCount: 3,
      distinctSessionCount: 2,
      distinctDayCount: 2,
      observedTags: ["engineering", "typescript"],
      domainTagOverlap: ["engineering"],
      domainTagOverlapCount: 1,
      domainTagOverlapRatio: 0.5,
      mostRecentAt: "2026-07-02T12:00:00.000Z",
      ageDays: 37,
    });
  });

  it("makes an explicitly protected fact the canonical duplicate", () => {
    const facts = [
      fact(1, "User avoids meetings", { time: "2026-01-01T10:00:00.000Z" }),
      fact(2, "User avoids meetings.", { time: "2026-07-01T10:00:00.000Z" }),
    ];
    const report = buildFactEvidence(facts, { now: NOW, protectedFactIds: [2] });

    expect(report.duplicateGroups[0].canonicalFactId).toBe(2);
    expect(report.facts.find((item) => item.factId === 2)).toMatchObject({
      isProtected: true,
      canonicalFactId: 2,
      canonicalText: "User avoids meetings.",
    });
    expect(report.facts.find((item) => item.factId === 1)?.isProtected).toBe(false);
  });

  it("is deterministic when source order changes", () => {
    const facts = [
      fact(10, "User prefers dark mode", { time: "2026-07-03T10:00:00.000Z" }),
      fact(2, "User prefers the dark mode", { time: "2026-07-02T10:00:00.000Z" }),
      fact(7, "The current task is complete", { time: "2026-07-01T10:00:00.000Z" }),
      fact(4, "THE CURRENT TASK IS COMPLETE.", { time: "2026-07-04T10:00:00.000Z" }),
    ];
    const options = { now: NOW, domainTags: ["engineering"] };

    expect(buildFactEvidence(facts, options)).toEqual(
      buildFactEvidence([facts[2], facts[0], facts[3], facts[1]], options),
    );
  });
});
