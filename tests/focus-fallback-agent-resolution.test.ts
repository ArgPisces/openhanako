import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * resolveAgent answered "which agent is this request about?" by falling back to
 * whichever agent the server was currently focused on when the request did not
 * say. That is a guess, and with two clients open on two different agents it is
 * sometimes the wrong one — a read can describe the other client's agent, a
 * write can land on it. It has been removed; resolveAgentStrict is the version
 * that refuses to guess.
 *
 * This count is permanently zero. A route that needs an agent takes an explicit
 * agentId and uses resolveAgentStrict; a route whose agent is optional passes
 * null onward instead of substituting one.
 */
const ROUTES_STILL_GUESSING: string[] = [];

const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "routes");

function routeFilesCallingFocusFallback() {
  return fs.readdirSync(routesDir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const source = fs.readFileSync(path.join(routesDir, name), "utf-8");
      // resolveAgentStrict( also contains resolveAgent, so require the exact call.
      return /(?<![A-Za-z])resolveAgent\(/.test(source);
    })
    .sort();
}

describe("focus-fallback agent resolution", () => {
  it("is not used by any route outside the known, shrinking list", () => {
    expect(routeFilesCallingFocusFallback()).toEqual([...ROUTES_STILL_GUESSING].sort());
  });

  it("is gone from the config route family", () => {
    const source = fs.readFileSync(path.join(routesDir, "config.ts"), "utf-8");
    expect(/(?<![A-Za-z])resolveAgent\(/.test(source)).toBe(false);
    // And nothing in that file reads the focus pointer to decide ownership.
    expect(source).not.toContain("currentAgentId");
  });
});
