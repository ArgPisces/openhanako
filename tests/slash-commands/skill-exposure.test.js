import { describe, it, expect, vi } from "vitest";
import { SlashCommandRegistry } from "../../core/slash-command-registry.js";
import { exposeSkillsAsCommands } from "../../core/slash-commands/index.js";

function mockEngine(skills) {
  return {
    getRuntimeSkills: vi.fn(() => skills),
  };
}

describe("exposeSkillsAsCommands", () => {
  it("registers each enabled visible skill as /<sanitizedName> with source=skill", () => {
    const r = new SlashCommandRegistry();
    const engine = mockEngine([
      { name: "My Skill", description: "do something", hidden: false, enabled: true },
      { name: "another-one", description: "x", hidden: false, enabled: true },
      { name: "dup", description: "", hidden: false, enabled: true },
      { name: "dup", description: "", hidden: false, enabled: true },
    ]);
    exposeSkillsAsCommands({ registry: r, engine, agentId: "a1" });
    expect(r.lookup("my_skill")?.source).toBe("skill");
    expect(r.lookup("my_skill")?.sourceId).toBe("a1");
    expect(r.lookup("another_one")?.source).toBe("skill");
    expect(r.lookup("dup")).not.toBeNull();
    expect(r.lookup("dup_2")).not.toBeNull();
  });

  it("skips hidden skills", () => {
    const r = new SlashCommandRegistry();
    const engine = mockEngine([
      { name: "shown", description: "", hidden: false, enabled: true },
      { name: "secret", description: "", hidden: true, enabled: true },
    ]);
    exposeSkillsAsCommands({ registry: r, engine, agentId: "a1" });
    expect(r.lookup("shown")?.name).toBe("shown");
    expect(r.lookup("secret")).toBeNull();
  });

  it("skips disabled skills", () => {
    const r = new SlashCommandRegistry();
    const engine = mockEngine([
      { name: "on_one", description: "", hidden: false, enabled: true },
      { name: "off_one", description: "", hidden: false, enabled: false },
    ]);
    exposeSkillsAsCommands({ registry: r, engine, agentId: "a1" });
    expect(r.lookup("on_one")?.name).toBe("on_one");
    expect(r.lookup("off_one")).toBeNull();
  });

  it("is idempotent: second call replaces previous skill commands for same agentId", () => {
    const r = new SlashCommandRegistry();
    let skills = [
      { name: "s1", description: "", hidden: false, enabled: true },
      { name: "s2", description: "", hidden: false, enabled: true },
    ];
    const engine = { getRuntimeSkills: () => skills };
    exposeSkillsAsCommands({ registry: r, engine, agentId: "a1" });
    expect(r.lookup("s1")).not.toBeNull();
    expect(r.lookup("s2")).not.toBeNull();

    // simulate: a skill was removed and another added
    skills = [
      { name: "s2", description: "", hidden: false, enabled: true },
      { name: "s3", description: "", hidden: false, enabled: true },
    ];
    exposeSkillsAsCommands({ registry: r, engine, agentId: "a1" });
    expect(r.lookup("s1")).toBeNull(); // removed
    expect(r.lookup("s2")).not.toBeNull(); // kept
    expect(r.lookup("s3")).not.toBeNull(); // added
  });

  it("unregisterBySource('skill', agentId) clears only that agent's skills", () => {
    const r = new SlashCommandRegistry();
    const engine = mockEngine([{ name: "x", description: "", hidden: false, enabled: true }]);
    exposeSkillsAsCommands({ registry: r, engine, agentId: "a1" });
    r.unregisterBySource("skill", "a1");
    expect(r.lookup("x")).toBeNull();
  });

  it("handles engine without getRuntimeSkills gracefully (empty no-op)", () => {
    const r = new SlashCommandRegistry();
    expect(() => exposeSkillsAsCommands({ registry: r, engine: {}, agentId: "a1" })).not.toThrow();
    expect(r.list()).toHaveLength(0);
  });
});
