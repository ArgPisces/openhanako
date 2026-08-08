import { beforeEach, describe, expect, it, vi } from "vitest";

const callTextMock = vi.fn();

vi.mock("../core/llm-client.ts", () => ({
  callText: (...args: any[]) => callTextMock(...args),
}));

import {
  atomizeDreamMemory,
  dedupeDreamMemory,
  optimizeDreamMemory,
  verifyDreamSections,
} from "../lib/memory/dream/model-runner.ts";

const resolvedModel = {
  model: { id: "utility-test" },
  provider: "test",
  api: "openai-completions",
  api_key: "test",
  base_url: "http://localhost",
};

const current = {
  facts: "User writes videos and maintains HanaAgent.",
  today: "Today stays outside Dream.",
  weekDays: [{ date: "2026-08-07", body: "Week stays outside Dream." }],
  longterm: "User likes concise answers.",
};

describe("Memory Dream three-stage model boundary", () => {
  beforeEach(() => callTextMock.mockReset());

  it("repairs non-atomic output and sends only resident Facts/Longterm blocks", async () => {
    callTextMock
      .mockResolvedValueOnce(JSON.stringify({
        units: [{
          sourceBlockId: "source:facts:0",
          section: "facts",
          text: "First fact。Second fact。",
        }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        units: [
          { sourceBlockId: "source:facts:0", section: "facts", text: "User writes videos." },
          { sourceBlockId: "source:facts:0", section: "facts", text: "User maintains HanaAgent." },
          { sourceBlockId: "source:longterm:0", section: "longterm", text: "User likes concise answers." },
        ],
      }));

    const result = await atomizeDreamMemory({ current, resolvedModel, trigger: "manual" });

    expect(result.units.map((unit) => unit.text)).toEqual([
      "User writes videos.",
      "User maintains HanaAgent.",
      "User likes concise answers.",
    ]);
    expect(callTextMock).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(callTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content);
    expect(payload.sourceBlocks.map((block: any) => block.section)).toEqual(["facts", "longterm"]);
    expect(JSON.stringify(payload)).not.toContain("Today stays outside Dream");
    expect(JSON.stringify(payload)).not.toContain("Week stays outside Dream");
    expect(JSON.stringify(payload)).not.toContain("facts.db");
    expect(payload.constraints.externalMemorySources).toBe("forbidden");
  });

  it("deduplicates only the supplied atomic units and keeps related units distinct", async () => {
    const units = [
      { id: "atom:0", sourceBlockIds: ["source:facts:0"], section: "facts" as const, text: "User prefers concise answers.", order: 0 },
      { id: "atom:1", sourceBlockIds: ["source:longterm:0"], section: "longterm" as const, text: "User likes concise responses.", order: 1 },
      { id: "atom:2", sourceBlockIds: ["source:longterm:1"], section: "longterm" as const, text: "User writes videos.", order: 2 },
    ];
    callTextMock.mockResolvedValueOnce(JSON.stringify({ groups: [
      { sourceUnitIds: ["atom:0", "atom:1"], relation: "same_meaning" },
      { sourceUnitIds: ["atom:2"], relation: "distinct" },
    ] }));

    const result = await dedupeDreamMemory({ units, resolvedModel, trigger: "manual" });

    expect(result.groups).toEqual([
      expect.objectContaining({ relation: "same_meaning", section: "facts" }),
      expect.objectContaining({ relation: "distinct", section: "longterm" }),
    ]);
    const payload = JSON.parse(callTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content);
    expect(payload).not.toHaveProperty("candidateUnits");
    expect(JSON.stringify(payload)).not.toContain("facts.db");
  });

  it("optimizes every dedupe group while preserving Today and Week exactly", async () => {
    const atomized = {
      sourceBlocks: [
        { id: "source:facts:0", section: "facts" as const, text: "User writes videos.", order: 0 },
        { id: "source:longterm:0", section: "longterm" as const, text: "User likes concise answers.", order: 1 },
      ],
      units: [
        { id: "atom:0", sourceBlockIds: ["source:facts:0"], section: "facts" as const, text: "User writes videos.", order: 0 },
        { id: "atom:1", sourceBlockIds: ["source:longterm:0"], section: "longterm" as const, text: "User likes concise answers.", order: 1 },
      ],
    };
    const dedupePlan = {
      inputUnits: atomized.units,
      units: atomized.units,
      exactDuplicateOperations: [],
      groups: [
        { id: "group:0", sourceUnitIds: ["atom:0"], sourceBlockIds: ["source:facts:0"], section: "facts" as const, relation: "distinct" as const, order: 0 },
        { id: "group:1", sourceUnitIds: ["atom:1"], sourceBlockIds: ["source:longterm:0"], section: "longterm" as const, relation: "distinct" as const, order: 1 },
      ],
    };
    callTextMock.mockResolvedValueOnce(JSON.stringify({
      units: [
        { groupId: "group:0", section: "facts", text: "User writes videos." },
        { groupId: "group:1", section: "longterm", text: "User prefers concise answers." },
      ],
      removedGroups: [],
    }));

    const result = await optimizeDreamMemory({
      current,
      sourceBlocks: atomized.sourceBlocks,
      atomicUnits: atomized.units,
      dedupePlan,
      resolvedModel,
      trigger: "manual",
    });

    expect(result.sections).toEqual({
      facts: "- User writes videos.",
      today: current.today,
      weekDays: current.weekDays,
      longterm: "- User prefers concise answers.",
    });
    const payload = JSON.parse(callTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content);
    expect(payload.safetyLimit).toEqual({
      maxTotalBodyChars: 5_000,
      maxEditableBodyChars: 4_949,
      currentEditableBodyChars: 70,
      preservedBodyChars: 51,
      role: "safety_ceiling_not_target",
    });
    expect(JSON.stringify(payload)).not.toContain("Today stays outside Dream");
    expect(JSON.stringify(payload)).not.toContain("Week stays outside Dream");
  });

  it("repairs optimizer output that violates the atomic unit contract", async () => {
    const sourceBlocks = [{ id: "source:facts:0", section: "facts" as const, text: "Known fact.", order: 0 }];
    const atomicUnits = [{ id: "atom:0", sourceBlockIds: ["source:facts:0"], section: "facts" as const, text: "Known fact.", order: 0 }];
    const dedupePlan = {
      inputUnits: atomicUnits,
      units: atomicUnits,
      exactDuplicateOperations: [],
      groups: [{ id: "group:0", sourceUnitIds: ["atom:0"], sourceBlockIds: ["source:facts:0"], section: "facts" as const, relation: "distinct" as const, order: 0 }],
    };
    callTextMock
      .mockResolvedValueOnce(JSON.stringify({
        units: [{ groupId: "group:0", section: "facts", text: "x".repeat(241) }],
        removedGroups: [],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        units: [{ groupId: "group:0", section: "facts", text: "Known fact." }],
        removedGroups: [],
      }));

    const result = await optimizeDreamMemory({
      current: { facts: "Known fact.", today: "", weekDays: [], longterm: "" },
      sourceBlocks,
      atomicUnits,
      dedupePlan,
      resolvedModel,
      trigger: "manual",
    });

    expect(result.sections.facts).toBe("- Known fact.");
    expect(callTextMock).toHaveBeenCalledTimes(2);
  });

  it("repairs otherwise atomic output above the loose 5000-character ceiling", async () => {
    const sourceBlocks = Array.from({ length: 22 }, (_, index) => ({
      id: `source:facts:${index}`,
      section: "facts" as const,
      text: `Known fact ${index}`,
      order: index,
    }));
    const atomicUnits = sourceBlocks.map((block, index) => ({
      id: `atom:${index}`,
      sourceBlockIds: [block.id],
      section: "facts" as const,
      text: block.text,
      order: index,
    }));
    const dedupePlan = {
      inputUnits: atomicUnits,
      units: atomicUnits,
      exactDuplicateOperations: [],
      groups: atomicUnits.map((unit, index) => ({
        id: `group:${index}`,
        sourceUnitIds: [unit.id],
        sourceBlockIds: [...unit.sourceBlockIds],
        section: "facts" as const,
        relation: "distinct" as const,
        order: index,
      })),
    };
    const oversized = dedupePlan.groups.map((group, index) => ({
      groupId: group.id,
      section: "facts",
      text: `${index}-`.padEnd(238, "x"),
    }));
    const repaired = dedupePlan.groups.map((group, index) => ({
      groupId: group.id,
      section: "facts",
      text: `Known fact ${index}`,
    }));
    callTextMock
      .mockResolvedValueOnce(JSON.stringify({ units: oversized, removedGroups: [] }))
      .mockResolvedValueOnce(JSON.stringify({ units: repaired, removedGroups: [] }));

    const result = await optimizeDreamMemory({
      current: { facts: sourceBlocks.map((block) => block.text).join("\n"), today: "", weekDays: [], longterm: "" },
      sourceBlocks,
      atomicUnits,
      dedupePlan,
      resolvedModel,
      trigger: "manual",
    });

    expect(result.optimizedUnits).toHaveLength(22);
    expect(callTextMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(callTextMock.mock.calls[1]?.[0])).toContain("safety limit is 5000");
  });

  it("uses an independent verifier to reject compound or unsupported output", async () => {
    callTextMock.mockResolvedValueOnce(JSON.stringify({
      ok: false,
      missingClaims: [],
      compoundUnits: ["result:0"],
      incorrectMerges: [],
      unsupportedClaims: [],
      subjectLeaks: [],
      unsafeRemovals: [],
      duplicateClaims: [],
    }));
    const plan: any = {
      sourceBlocks: [], atomicUnits: [], dedupePlan: { exactDuplicateOperations: [], groups: [] },
      optimizedUnits: [], removedGroups: [], sections: current,
    };

    await expect(verifyDreamSections({
      current,
      plan,
      resolvedModel,
      trigger: "manual",
    })).rejects.toThrow("compoundUnits=1");
  });
});
