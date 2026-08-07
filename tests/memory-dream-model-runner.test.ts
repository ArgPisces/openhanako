import { beforeEach, describe, expect, it, vi } from "vitest";

const callTextMock = vi.fn();

vi.mock("../core/llm-client.ts", () => ({
  callText: (...args: any[]) => callTextMock(...args),
}));

import {
  analyzeDreamCandidates,
  verifyDreamSections,
  writeDreamSections,
  type DreamAnalyzerInput,
} from "../lib/memory/dream/model-runner.ts";

const resolvedModel = {
  model: { id: "utility-test" },
  provider: "test",
  api: "openai-completions",
  api_key: "test",
  base_url: "http://localhost",
};

function group(overrides: Partial<DreamAnalyzerInput> = {}): DreamAnalyzerInput {
  return {
    groupId: "fact:number:1",
    canonicalFact: "User prefers concise answers",
    sourceFacts: ["User prefers concise answers"],
    allowedActions: ["keep", "forget", "review"],
    protected: false,
    ruleAction: "keep",
    evidence: { distinctSessionCount: 2, distinctDayCount: 2 },
    ruleReasons: ["multi_session", "multi_day"],
    ...overrides,
  };
}

describe("Memory Dream structured model boundary", () => {
  beforeEach(() => callTextMock.mockReset());

  it("repairs analyzer coverage once and accepts only known IDs", async () => {
    callTextMock
      .mockResolvedValueOnce(JSON.stringify({
        decisions: [{
          groupId: "invented",
          action: "keep",
          subject: "user",
          temporal: "stable",
          canonicalFact: "invented",
          reasonCodes: [],
        }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        decisions: [{
          groupId: "fact:number:1",
          action: "keep",
          subject: "user",
          temporal: "stable",
          canonicalFact: "User prefers concise answers",
          reasonCodes: ["multi_session"],
        }],
      }));

    const result = await analyzeDreamCandidates({
      groups: [group()],
      resolvedModel,
      trigger: "manual",
    });

    expect(result).toEqual([expect.objectContaining({
      groupId: "fact:number:1",
      action: "keep",
      subject: "user",
    })]);
    expect(callTextMock).toHaveBeenCalledTimes(2);
  });

  it("rejects forgetting stable recurring user evidence after one repair", async () => {
    const invalid = JSON.stringify({
      decisions: [{
        groupId: "fact:number:1",
        action: "forget",
        subject: "user",
        temporal: "stable",
        canonicalFact: "User prefers concise answers",
        reasonCodes: [],
      }],
    });
    callTextMock.mockResolvedValue(invalid);

    await expect(analyzeDreamCandidates({
      groups: [group()],
      resolvedModel,
      trigger: "manual",
    })).rejects.toThrow("stable user evidence");
    expect(callTextMock).toHaveBeenCalledTimes(2);
  });

  it("repairs structured source coverage while preserving Today and Week exactly", async () => {
    const sections = {
      facts: "Concise answers are preferred.",
      today: "Working on memory quality.",
      weekDays: [{ date: "2026-08-07", body: "Reviewed memory design." }],
      longterm: "L".repeat(1_251),
    };
    const residentOnly = {
      units: [
        {
          sourceUnitIds: ["resident:facts:0"],
          text: "Concise answers are preferred.",
          section: "facts",
          relation: "unchanged",
        },
        {
          sourceUnitIds: ["resident:longterm:0"],
          text: "L".repeat(1_251),
          section: "longterm",
          relation: "unchanged",
        },
      ],
      removedUnits: [],
    };
    callTextMock
      .mockResolvedValueOnce(JSON.stringify(residentOnly))
      .mockResolvedValueOnce(JSON.stringify({
        units: [
          {
            sourceUnitIds: ["resident:facts:0", "candidate:fact:number:1"],
            text: "Concise answers are preferred.",
            section: "facts",
            relation: "same_meaning",
          },
          residentOnly.units[1],
        ],
        removedUnits: [],
      }));

    const result = await writeDreamSections({
      current: sections,
      decisions: [{
        groupId: "fact:number:1",
        action: "keep",
        subject: "user",
        temporal: "stable",
        canonicalFact: "User prefers concise answers",
        reasonCodes: [],
      }],
      evidence: [group()],
      resolvedModel,
      trigger: "manual",
    });

    expect(result.sections.today).toBe(sections.today);
    expect(result.sections.weekDays).toEqual(sections.weekDays);
    expect(result.sections.facts).toBe("- Concise answers are preferred.");
    expect(result.mergedCount).toBe(1);
    expect(callTextMock).toHaveBeenCalledTimes(2);
    const writerPayload = JSON.parse(callTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content);
    expect(writerPayload.safetyLimit).toEqual({
      maxTotalBodyChars: 5_000,
      maxEditableBodyChars: 4_951,
      preservedBodyChars: 49,
      role: "safety_ceiling_not_target",
    });
    expect(writerPayload).not.toHaveProperty("budgets");
    expect(writerPayload.residentUnits.map((unit: any) => unit.section)).toEqual(["facts", "longterm"]);
    expect(JSON.stringify(writerPayload)).not.toContain("Working on memory quality");
    expect(JSON.stringify(writerPayload)).not.toContain("Reviewed memory design");
  });

  it("does not force review candidates into resident memory or verifier coverage", async () => {
    const sections = {
      facts: "Concise answers are preferred.",
      today: "",
      weekDays: [],
      longterm: "",
    };
    callTextMock.mockResolvedValueOnce(JSON.stringify({
      units: [{
        sourceUnitIds: ["resident:facts:0"],
        text: "Concise answers are preferred.",
        section: "facts",
        relation: "unchanged",
      }],
      removedUnits: [],
    }));

    const result = await writeDreamSections({
      current: sections,
      decisions: [{
        groupId: "fact:number:1",
        action: "review",
        subject: "unknown",
        temporal: "unknown",
        canonicalFact: "A single uncertain observation",
        reasonCodes: [],
      }],
      evidence: [group()],
      resolvedModel,
      trigger: "manual",
    });

    expect(result.candidateUnits[0]?.action).toBe("review");
    expect(result.proposedUnits.flatMap((unit) => unit.sourceUnitIds))
      .not.toContain("candidate:fact:number:1");
    callTextMock.mockResolvedValueOnce(JSON.stringify({
      ok: true,
      missingGroupIds: [],
      unsupportedClaims: [],
      subjectLeaks: [],
      lostStableClaims: [],
      duplicateClaims: [],
    }));
    await expect(verifyDreamSections({
      current: sections,
      proposed: result.sections,
      decisions: [{
        groupId: "fact:number:1",
        action: "review",
        subject: "unknown",
        temporal: "unknown",
        canonicalFact: "A single uncertain observation",
        reasonCodes: [],
      }],
      evidence: [group()],
      resolvedModel,
      trigger: "manual",
      unitPlan: result,
    })).resolves.toEqual({ ok: true });

    const verifierPayload = JSON.parse(callTextMock.mock.calls[1]?.[0]?.messages?.[0]?.content);
    expect(verifierPayload.requiredCandidateUnitIds).toEqual([]);
    expect(callTextMock).toHaveBeenCalledTimes(2);
  });

  it("repairs output only when the combined body exceeds the 5000 character safety ceiling", async () => {
    const resultFor = (text: string) => ({
      units: [{
        sourceUnitIds: ["resident:facts:0"],
        text,
        section: "facts",
        relation: "unchanged",
      }],
      removedUnits: [],
    });
    callTextMock
      .mockResolvedValueOnce(JSON.stringify(resultFor("F".repeat(5_001))))
      .mockResolvedValueOnce(JSON.stringify(resultFor("F".repeat(4_900))));

    const result = await writeDreamSections({
      current: { facts: "short", today: "", weekDays: [], longterm: "" },
      decisions: [],
      evidence: [],
      resolvedModel,
      trigger: "manual",
    });

    expect(result.sections.facts).toHaveLength(4_902);
    expect(callTextMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(callTextMock.mock.calls[1]?.[0])).toContain("5003");
    expect(JSON.stringify(callTextMock.mock.calls[1]?.[0])).toContain("5000");
  });

  it("grandfathers an existing body above 5000 characters without allowing further growth", async () => {
    const text = "F".repeat(5_100);
    const resultFor = (value: string) => ({
      units: [{
        sourceUnitIds: ["resident:facts:0"],
        text: value,
        section: "facts",
        relation: "unchanged",
      }],
      removedUnits: [],
    });
    callTextMock.mockResolvedValueOnce(JSON.stringify(resultFor(text)));

    const result = await writeDreamSections({
      current: { facts: `- ${text}`, today: "", weekDays: [], longterm: "" },
      decisions: [],
      evidence: [],
      resolvedModel,
      trigger: "manual",
    });

    expect(result.sections.facts).toBe(`- ${text}`);
    expect(callTextMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(callTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content);
    expect(payload.safetyLimit.maxTotalBodyChars).toBe(5_102);
  });

  it("uses an independent verifier to reject unsupported rewrites", async () => {
    callTextMock.mockResolvedValueOnce(JSON.stringify({
      ok: false,
      missingGroupIds: [],
      unsupportedClaims: ["User owns a spaceship"],
      subjectLeaks: [],
      lostStableClaims: [],
      duplicateClaims: [],
    }));
    const sections = { facts: "Concise answers.", today: "", weekDays: [], longterm: "" };

    await expect(verifyDreamSections({
      current: sections,
      proposed: { ...sections, facts: "User owns a spaceship." },
      decisions: [],
      evidence: [],
      resolvedModel,
      trigger: "manual",
    })).rejects.toThrow("verification failed");
  });
});
