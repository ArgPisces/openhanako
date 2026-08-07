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

  it("repairs writer coverage while preserving the exact week date set and budgets", async () => {
    const sections = {
      facts: "Concise answers are preferred.",
      today: "Working on memory quality.",
      weekDays: [{ date: "2026-08-07", body: "Reviewed memory design." }],
      longterm: "Hana is the user's personal agent.",
    };
    callTextMock
      .mockResolvedValueOnce(JSON.stringify({ sections, coverage: [], notes: [] }))
      .mockResolvedValueOnce(JSON.stringify({
        sections,
        coverage: ["fact:number:1"],
        notes: ["Merged recurring preference."],
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
      budgets: { facts: 200, today: 200, week: 200, longterm: 200, hardTotal: 800 },
      resolvedModel,
      trigger: "manual",
    });

    expect(result.sections.weekDays).toEqual(sections.weekDays);
    expect(result.coverage).toEqual(["fact:number:1"]);
    expect(callTextMock).toHaveBeenCalledTimes(2);
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
