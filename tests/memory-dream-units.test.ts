import { describe, expect, it } from "vitest";
import {
  buildDreamSourceBlocks,
  prepareDreamDedupe,
  validateAndRenderDreamOptimization,
  validateDreamAtomization,
  validateDreamDedupe,
} from "../lib/memory/dream/memory-units.ts";

const current = {
  facts: "User prefers concise answers。User asks for concrete evidence；User values privacy。",
  today: "Today must not enter Dream.",
  weekDays: [{ date: "2026-08-07", body: "Week must not enter Dream." }],
  longterm: "### Milestone\nHana shipped a local build.",
};

describe("Memory Dream closed unit pipeline", () => {
  it("builds traceable source blocks only from current Facts and Longterm", () => {
    expect(buildDreamSourceBlocks(current)).toEqual([
      { id: "source:facts:0", section: "facts", text: "User prefers concise answers。", order: 0 },
      { id: "source:facts:1", section: "facts", text: "User asks for concrete evidence；", order: 1 },
      { id: "source:facts:2", section: "facts", text: "User values privacy。", order: 2 },
      { id: "source:longterm:0", section: "longterm", text: "Milestone: Hana shipped a local build.", order: 3 },
    ]);
  });

  it("requires the atomizer to cover every source while allowing a source to split", () => {
    const sourceBlocks = buildDreamSourceBlocks({
      facts: "User writes videos and maintains HanaAgent.",
      today: "",
      weekDays: [],
      longterm: "",
    });
    const units = validateDreamAtomization({
      units: [
        { sourceBlockId: "source:facts:0", section: "facts", text: "User writes videos." },
        { sourceBlockId: "source:facts:0", section: "facts", text: "User maintains HanaAgent." },
      ],
    }, sourceBlocks);

    expect(units.map((unit) => unit.text)).toEqual([
      "User writes videos.",
      "User maintains HanaAgent.",
    ]);
    expect(units.every((unit) => unit.sourceBlockIds[0] === "source:facts:0")).toBe(true);
  });

  it("rejects a giant or multi-sentence pseudo-unit instead of accepting a paragraph as one item", () => {
    const sourceBlocks = buildDreamSourceBlocks({ facts: "Known source.", today: "", weekDays: [], longterm: "" });
    expect(() => validateDreamAtomization({
      units: [{
        sourceBlockId: "source:facts:0",
        section: "facts",
        text: "First independent fact。Second independent fact。",
      }],
    }, sourceBlocks)).toThrow("compound multi-sentence unit");

    expect(() => validateDreamAtomization({
      units: [{ sourceBlockId: "source:facts:0", section: "facts", text: "x".repeat(241) }],
    }, sourceBlocks)).toThrow("240-character atomic limit");
  });

  it("removes exact duplicates deterministically before semantic dedupe, with Facts winning", () => {
    const units = [
      { id: "atom:0", sourceBlockIds: ["source:longterm:0"], section: "longterm" as const, text: "User prefers concise answers.", order: 1 },
      { id: "atom:1", sourceBlockIds: ["source:facts:0"], section: "facts" as const, text: "User prefers concise answers.", order: 0 },
    ];
    const prepared = prepareDreamDedupe(units);

    expect(prepared.units).toEqual([expect.objectContaining({
      id: "atom:1",
      section: "facts",
      sourceBlockIds: ["source:longterm:0", "source:facts:0"],
    })]);
    expect(prepared.exactDuplicateOperations).toEqual([{
      kind: "remove_exact_duplicate",
      canonicalUnitId: "atom:1",
      removedUnitIds: ["atom:0"],
    }]);
  });

  it("requires semantic dedupe to cover every resident atom exactly once", () => {
    const units = [
      { id: "atom:0", sourceBlockIds: ["source:facts:0"], section: "facts" as const, text: "User prefers concise answers.", order: 0 },
      { id: "atom:1", sourceBlockIds: ["source:longterm:0"], section: "longterm" as const, text: "User likes concise responses.", order: 1 },
      { id: "atom:2", sourceBlockIds: ["source:longterm:1"], section: "longterm" as const, text: "User writes videos.", order: 2 },
    ];
    const prepared = prepareDreamDedupe(units);
    const plan = validateDreamDedupe({ groups: [
      { sourceUnitIds: ["atom:0", "atom:1"], relation: "same_meaning" },
      { sourceUnitIds: ["atom:2"], relation: "distinct" },
    ] }, prepared);

    expect(plan.groups[0]).toEqual(expect.objectContaining({
      section: "facts",
      relation: "same_meaning",
    }));
    expect(() => validateDreamDedupe({ groups: [
      { sourceUnitIds: ["atom:0", "atom:1"], relation: "distinct" },
      { sourceUnitIds: ["atom:2"], relation: "distinct" },
    ] }, prepared)).toThrow("may not group related or conflicting");
  });

  it("optimizes one output per dedupe group and renders deterministic list rows", () => {
    const sourceBlocks = buildDreamSourceBlocks({
      facts: "User prefers concise answers.\nUser likes concise responses.",
      today: current.today,
      weekDays: current.weekDays,
      longterm: "A completed temporary export command was run.",
    });
    const atomicUnits = validateDreamAtomization({ units: [
      { sourceBlockId: "source:facts:0", section: "facts", text: "User prefers concise answers." },
      { sourceBlockId: "source:facts:1", section: "facts", text: "User likes concise responses." },
      { sourceBlockId: "source:longterm:0", section: "longterm", text: "A completed temporary export command was run." },
    ] }, sourceBlocks);
    const prepared = prepareDreamDedupe(atomicUnits);
    const dedupePlan = validateDreamDedupe({ groups: [
      { sourceUnitIds: ["atom:0", "atom:1"], relation: "same_meaning" },
      { sourceUnitIds: ["atom:2"], relation: "distinct" },
    ] }, prepared);
    const plan = validateAndRenderDreamOptimization({
      units: [{ groupId: "group:0", section: "facts", text: "User prefers concise answers." }],
      removedGroups: [{ groupId: "group:1", reason: "operational_noise" }],
    }, sourceBlocks, atomicUnits, dedupePlan, {
      facts: "User prefers concise answers.\nUser likes concise responses.",
      today: current.today,
      weekDays: current.weekDays,
      longterm: "A completed temporary export command was run.",
    });

    expect(plan.sections).toEqual({
      facts: "- User prefers concise answers.",
      today: current.today,
      weekDays: current.weekDays,
      longterm: "",
    });
    expect(plan.mergedCount).toBe(1);
    expect(plan.forgottenCount).toBe(1);
  });

  it("rejects external IDs at every stage", () => {
    const sourceBlocks = buildDreamSourceBlocks({ facts: "Known fact.", today: "", weekDays: [], longterm: "" });
    expect(() => validateDreamAtomization({
      units: [{ sourceBlockId: "facts.db:9", section: "facts", text: "Database fact." }],
    }, sourceBlocks)).toThrow("unknown source block");
  });
});
