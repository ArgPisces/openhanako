import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * resolveAgent answers "which agent is this request about?" by falling back to
 * whichever agent the server is currently focused on when the request does not
 * say. That is a guess, and with two clients open on two different agents it is
 * sometimes the wrong one — a read can describe the other client's agent, a
 * write can land on it. resolveAgentStrict is the version that refuses to
 * guess.
 *
 * The remaining users below are the ones that have not been converted yet. The
 * list is allowed to shrink and never to grow: a new entry means a new place
 * where the server picks an agent on the caller's behalf. If you are adding a
 * route, take an explicit agentId and use resolveAgentStrict instead of adding
 * yourself here.
 */
const ROUTES_STILL_GUESSING = [
  "plugins.ts",
];

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
