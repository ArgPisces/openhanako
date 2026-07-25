import { describe, expect, it } from "vitest";

import { pickCliAgent } from "../server/cli.ts";

describe("CLI agent selection", () => {
  it("names the agent this terminal session is attached to", () => {
    const agents = [
      { id: "mio", isPrimary: true, isCurrent: false },
      { id: "hana", isPrimary: false, isCurrent: true },
    ];
    expect(pickCliAgent(agents)?.id).toBe("hana");
  });

  it("falls back to the primary agent, then to the first one", () => {
    expect(pickCliAgent([
      { id: "mio", isPrimary: true, isCurrent: false },
      { id: "hana", isPrimary: false, isCurrent: false },
    ])?.id).toBe("mio");
    expect(pickCliAgent([
      { id: "hana", isPrimary: false, isCurrent: false },
    ])?.id).toBe("hana");
  });

  it("returns null rather than guessing when there is nothing to pick from", () => {
    expect(pickCliAgent([])).toBeNull();
    expect(pickCliAgent(undefined)).toBeNull();
    expect(pickCliAgent(null)).toBeNull();
  });
});
