import { describe, expect, it } from "vitest";
import {
  atomizeDreamSections,
  prepareDreamUnits,
  validateAndRenderDreamUnitPlan,
} from "../lib/memory/dream/memory-units.ts";

const emptyDecisionInput = { decisions: [], evidence: [] };

describe("Memory Dream units", () => {
  it("atomizes only Facts and Longterm into traceable plain units", () => {
    const units = atomizeDreamSections({
      facts: "- User prefers concise answers.\n2. User prefers concrete evidence.",
      today: "Today must not enter Dream.",
      weekDays: [{ date: "2026-08-07", body: "Week must not enter Dream." }],
      longterm: "### Milestone\nHana shipped a local build.",
    });

    expect(units.map((unit) => ({
      id: unit.id,
      section: unit.section,
      text: unit.text,
      sourceRefs: unit.sourceRefs,
    }))).toEqual([
      {
        id: "resident:facts:0",
        section: "facts",
        text: "User prefers concise answers.",
        sourceRefs: ["memory:facts:0"],
      },
      {
        id: "resident:facts:1",
        section: "facts",
        text: "User prefers concrete evidence.",
        sourceRefs: ["memory:facts:1"],
      },
      {
        id: "resident:longterm:0",
        section: "longterm",
        text: "Milestone: Hana shipped a local build.",
        sourceRefs: ["memory:longterm:0"],
      },
    ]);
  });

  it("lets the writer split multiple assertions from one source line", () => {
    const units = atomizeDreamSections({
      facts: "User prefers concise answers and asks for evidence.",
      today: "",
      weekDays: [],
      longterm: "",
    });

    expect(units).toHaveLength(1);
    expect(units[0].text).toBe("User prefers concise answers and asks for evidence.");

    const prepared = prepareDreamUnits({
      current: {
        facts: units[0].text,
        today: "",
        weekDays: [],
        longterm: "",
      },
      ...emptyDecisionInput,
    });
    const plan = validateAndRenderDreamUnitPlan({
      units: [
        {
          sourceUnitIds: ["resident:facts:0"],
          text: "User prefers concise answers.",
          section: "facts",
          relation: "split",
        },
        {
          sourceUnitIds: ["resident:facts:0"],
          text: "User asks for evidence.",
          section: "facts",
          relation: "split",
        },
      ],
      removedUnits: [],
    }, prepared);
    expect(plan.sections.facts).toBe(
      "- User prefers concise answers.\n- User asks for evidence.",
    );
  });

  it("removes exact resident duplicates deterministically with Facts winning over Longterm", () => {
    const current = {
      facts: "User prefers concise answers.",
      today: "Today stays byte-for-byte.",
      weekDays: [{ date: "2026-08-07", body: "Week stays byte-for-byte." }],
      longterm: "User prefers concise answers.\nIn 2026 Hana completed the plugin migration.",
    };
    const prepared = prepareDreamUnits({ current, ...emptyDecisionInput });

    expect(prepared.exactDuplicateOperations).toEqual([{
      kind: "remove_exact_duplicate",
      canonicalUnitId: "resident:facts:0",
      removedUnitIds: ["resident:longterm:0"],
    }]);

    const plan = validateAndRenderDreamUnitPlan({
      units: [
        {
          sourceUnitIds: ["resident:facts:0"],
          text: "User prefers concise answers.",
          section: "facts",
          relation: "unchanged",
        },
        {
          sourceUnitIds: ["resident:longterm:1"],
          text: "In 2026 Hana completed the plugin migration.",
          section: "longterm",
          relation: "unchanged",
        },
      ],
      removedUnits: [],
    }, prepared);

    expect(plan.sections).toEqual({
      facts: "- User prefers concise answers.",
      today: current.today,
      weekDays: current.weekDays,
      longterm: "- In 2026 Hana completed the plugin migration.",
    });
    expect(plan.mergedCount).toBe(1);
    expect(plan.forgottenCount).toBe(0);
  });

  it("canonicalizes a semantic Facts/Longterm duplicate into Facts", () => {
    const current = {
      facts: "User prefers concise answers.",
      today: "",
      weekDays: [],
      longterm: "User likes concise responses.",
    };
    const prepared = prepareDreamUnits({ current, ...emptyDecisionInput });
    const plan = validateAndRenderDreamUnitPlan({
      units: [{
        sourceUnitIds: ["resident:facts:0", "resident:longterm:0"],
        text: "User prefers concise answers.",
        section: "facts",
        relation: "same_meaning",
      }],
      removedUnits: [],
    }, prepared);

    expect(plan.sections.facts).toBe("- User prefers concise answers.");
    expect(plan.sections.longterm).toBe("");
    expect(plan.mergedCount).toBe(1);
  });

  it("rejects moving unique dated Longterm context into Facts", () => {
    const current = {
      facts: "",
      today: "",
      weekDays: [],
      longterm: "In 2026 Hana completed the plugin migration.",
    };
    const decisions = [{
      groupId: "fact:number:1",
      action: "keep" as const,
      subject: "project" as const,
      temporal: "stable" as const,
      canonicalFact: "Hana completed the plugin migration",
      reasonCodes: [],
    }];
    const evidence = [{
      groupId: "fact:number:1",
      canonicalFact: "Hana completed the plugin migration",
      sourceFacts: ["Hana completed the plugin migration"],
      sourceFactIds: ["1"],
      allowedActions: ["keep"],
      protected: false,
      ruleAction: "keep" as const,
      evidence: {},
      ruleReasons: [],
    }];
    const prepared = prepareDreamUnits({ current, decisions, evidence });

    expect(() => validateAndRenderDreamUnitPlan({
      units: [{
        sourceUnitIds: ["resident:longterm:0", "candidate:fact:number:1"],
        text: "Hana completed the plugin migration in 2026.",
        section: "facts",
        relation: "same_meaning",
      }],
      removedUnits: [],
    }, prepared)).toThrow("unique dated or historical Longterm context");

    const plan = validateAndRenderDreamUnitPlan({
      units: [
        {
          sourceUnitIds: ["candidate:fact:number:1"],
          text: "Hana completed the plugin migration.",
          section: "facts",
          relation: "unchanged",
        },
        {
          sourceUnitIds: ["resident:longterm:0"],
          text: "In 2026 Hana completed the plugin migration.",
          section: "longterm",
          relation: "unchanged",
        },
      ],
      removedUnits: [],
    }, prepared);
    expect(plan.sections.longterm).toContain("In 2026");
  });

  it("rejects hallucinated unit IDs before rendering", () => {
    const current = { facts: "Known fact.", today: "", weekDays: [], longterm: "" };
    const prepared = prepareDreamUnits({ current, ...emptyDecisionInput });
    expect(() => validateAndRenderDreamUnitPlan({
      units: [{
        sourceUnitIds: ["resident:facts:999"],
        text: "Invented fact.",
        section: "facts",
        relation: "unchanged",
      }],
      removedUnits: [],
    }, prepared)).toThrow("unknown source");
  });

  it("counts only an evidence-backed resident removal as forgotten", () => {
    const current = {
      facts: "",
      today: "Untouched today.",
      weekDays: [],
      longterm: "The one-off launch checklist is closed.",
    };
    const decisions = [{
      groupId: "fact:number:9",
      action: "forget" as const,
      subject: "project" as const,
      temporal: "closed" as const,
      canonicalFact: "The one-off launch checklist is closed.",
      reasonCodes: ["closed"],
    }];
    const evidence = [{
      groupId: "fact:number:9",
      canonicalFact: "The one-off launch checklist is closed.",
      sourceFacts: ["The one-off launch checklist is closed."],
      sourceFactIds: ["9"],
      allowedActions: ["forget"],
      protected: false,
      ruleAction: "forget" as const,
      evidence: {},
      ruleReasons: ["old", "peripheral"],
    }];
    const prepared = prepareDreamUnits({ current, decisions, evidence });
    const plan = validateAndRenderDreamUnitPlan({
      units: [],
      removedUnits: [{
        sourceUnitId: "resident:longterm:0",
        supportingCandidateUnitIds: ["candidate:fact:number:9"],
        reason: "closed",
      }],
    }, prepared);

    expect(plan.sections.longterm).toBe("");
    expect(plan.sections.today).toBe(current.today);
    expect(plan.forgottenCount).toBe(1);
    expect(plan.mergedCount).toBe(0);
    expect(plan.operations).toContainEqual({
      kind: "forget",
      sourceUnitIds: ["resident:longterm:0"],
      resultUnitIds: [],
    });
  });

  it("rejects removal evidence whose semantic state is not closed or obsolete", () => {
    const current = {
      facts: "User still prefers concise answers.",
      today: "",
      weekDays: [],
      longterm: "",
    };
    const decisions = [{
      groupId: "fact:number:10",
      action: "forget" as const,
      subject: "user" as const,
      temporal: "stable" as const,
      canonicalFact: "User still prefers concise answers.",
      reasonCodes: [],
    }];
    const evidence = [{
      groupId: "fact:number:10",
      canonicalFact: "User still prefers concise answers.",
      sourceFacts: ["User still prefers concise answers."],
      sourceFactIds: ["10"],
      allowedActions: ["forget"],
      protected: false,
      ruleAction: "forget" as const,
      evidence: {},
      ruleReasons: [],
    }];
    const prepared = prepareDreamUnits({ current, decisions, evidence });

    expect(() => validateAndRenderDreamUnitPlan({
      units: [],
      removedUnits: [{
        sourceUnitId: "resident:facts:0",
        supportingCandidateUnitIds: ["candidate:fact:number:10"],
        reason: "obsolete",
      }],
    }, prepared)).toThrow("closed or obsolete candidate");
  });
});
