import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { healCredentialFileModes } from "../core/credential-file-healer.ts";
import { LOCAL_PROVIDER_PLUGINS_DIR } from "../core/local-provider-plugin-store.ts";

const POSIX = process.platform !== "win32";

let home: string | null = null;

function makeHome() {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hana-credential-healer-"));
  return home;
}

function writeOpen(relativePath: string, content = "{}\n") {
  const target = path.join(home!, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  fs.chmodSync(target, 0o644);
  return target;
}

function modeOf(target: string) {
  return fs.statSync(target).mode & 0o777;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (home) fs.rmSync(home, { recursive: true, force: true });
  home = null;
});

describe.skipIf(!POSIX)("healCredentialFileModes", () => {
  it("tightens the data directory itself", () => {
    const root = makeHome();
    fs.chmodSync(root, 0o755);

    const result = healCredentialFileModes({ hanakoHome: root });

    expect(modeOf(root)).toBe(0o700);
    expect(result.healed).toContain(".");
  });

  it("tightens every known credential file at the top level", () => {
    const root = makeHome();
    const targets = [
      "provider-catalog.json",
      "models.json",
      "added-models.yaml",
      "auth.json",
      "device-credentials.json",
      "devices.json",
      "pairing-sessions.json",
      "local-user-auth.json",
      "users.json",
      "web-sessions.json",
    ];
    for (const name of targets) writeOpen(name);

    const result = healCredentialFileModes({ hanakoHome: root });

    for (const name of targets) {
      expect(modeOf(path.join(root, name))).toBe(0o600);
      expect(result.healed).toContain(name);
    }
  });

  it("tightens per-agent configuration files", () => {
    const root = makeHome();
    writeOpen(path.join("agents", "hanako", "config.yaml"), "api:\n  api_key: value\n");
    writeOpen(path.join("agents", "second", "config.yaml"), "api:\n  api_key: value\n");

    healCredentialFileModes({ hanakoHome: root });

    expect(modeOf(path.join(root, "agents", "hanako", "config.yaml"))).toBe(0o600);
    expect(modeOf(path.join(root, "agents", "second", "config.yaml"))).toBe(0o600);
  });

  it("tightens migration backup directories and everything inside them", () => {
    const root = makeHome();
    const backupDir = path.join(root, "migration-backups", "provider-catalog-v1-2026-01-01");
    writeOpen(path.join("migration-backups", "provider-catalog-v1-2026-01-01", "added-models.yaml"));
    writeOpen(path.join("migration-backups", "provider-catalog-v1-2026-01-01", "models.json"));
    fs.chmodSync(backupDir, 0o755);
    fs.chmodSync(path.join(root, "migration-backups"), 0o755);

    healCredentialFileModes({ hanakoHome: root });

    expect(modeOf(path.join(root, "migration-backups"))).toBe(0o700);
    expect(modeOf(backupDir)).toBe(0o700);
    expect(modeOf(path.join(backupDir, "added-models.yaml"))).toBe(0o600);
    expect(modeOf(path.join(backupDir, "models.json"))).toBe(0o600);
  });

  // The tree is located through LOCAL_PROVIDER_PLUGINS_DIR rather than a
  // literal, because the healer reads a directory name that the store owns.
  // A guard that only asserts a string is in SECRET_TREES passes even when the
  // two names have drifted apart and the healer walks a path that never exists.
  it("tightens locally defined provider plugins, whose files carry that provider's key", () => {
    const root = makeHome();
    const pluginRoot = path.join(root, LOCAL_PROVIDER_PLUGINS_DIR);
    const providerDir = path.join(pluginRoot, "acme");
    const keyFile = path.join(LOCAL_PROVIDER_PLUGINS_DIR, "acme", "providers", "acme.json");
    writeOpen(keyFile, JSON.stringify({ api_key: "value" }));
    fs.chmodSync(providerDir, 0o755);
    fs.chmodSync(pluginRoot, 0o755);

    const result = healCredentialFileModes({ hanakoHome: root });

    expect(modeOf(pluginRoot)).toBe(0o700);
    expect(modeOf(providerDir)).toBe(0o700);
    expect(modeOf(path.join(root, keyFile))).toBe(0o600);
    expect(result.healed).toContain(keyFile);
  });

  it("tightens agent configuration captured inside migration checkpoints", () => {
    const root = makeHome();
    writeOpen(
      path.join("checkpoints", "session-manifest", "cp-1", "agents", "hanako", "config.yaml"),
      "api:\n  api_key: value\n",
    );

    healCredentialFileModes({ hanakoHome: root });

    expect(
      modeOf(path.join(root, "checkpoints", "session-manifest", "cp-1", "agents", "hanako", "config.yaml")),
    ).toBe(0o600);
  });

  it("reports each correction so the run leaves a trace", () => {
    const root = makeHome();
    writeOpen("provider-catalog.json");
    const lines: string[] = [];

    const result = healCredentialFileModes({ hanakoHome: root, log: (line: string) => lines.push(line) });

    expect(result.healed).toContain("provider-catalog.json");
    expect(lines.join("\n")).toContain("provider-catalog.json");
  });

  it("stays quiet when everything is already owner-only", () => {
    const root = makeHome();
    fs.chmodSync(root, 0o700);
    const target = path.join(root, "provider-catalog.json");
    fs.writeFileSync(target, "{}\n");
    fs.chmodSync(target, 0o600);
    const lines: string[] = [];

    const result = healCredentialFileModes({ hanakoHome: root, log: (line: string) => lines.push(line) });

    expect(result.healed).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("refuses a missing data directory instead of reporting a clean run", () => {
    expect(() => healCredentialFileModes({ hanakoHome: "" })).toThrowError(/data directory/);
  });

  it("skips files that are absent instead of failing", () => {
    const root = makeHome();
    fs.chmodSync(root, 0o700);

    const result = healCredentialFileModes({ hanakoHome: root });

    expect(result.failed).toEqual([]);
  });

  it("reports a file it could not correct and still handles the rest", () => {
    const root = makeHome();
    fs.chmodSync(root, 0o700);
    writeOpen("provider-catalog.json");
    writeOpen("models.json");
    const realChmod = fs.chmodSync;
    vi.spyOn(fs, "chmodSync").mockImplementation((target: any, mode: any) => {
      if (String(target).endsWith("provider-catalog.json")) {
        const err: any = new Error("EACCES: permission denied");
        err.code = "EACCES";
        throw err;
      }
      return realChmod(target, mode);
    });
    const lines: string[] = [];

    const result = healCredentialFileModes({ hanakoHome: root, log: (line: string) => lines.push(line) });

    expect(result.failed).toContain("provider-catalog.json");
    expect(result.healed).toContain("models.json");
    expect(modeOf(path.join(root, "models.json"))).toBe(0o600);
    expect(lines.join("\n")).toContain("provider-catalog.json");
  });
});
