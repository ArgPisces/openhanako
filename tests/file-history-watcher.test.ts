import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createWorkspaceWatcher } from "../lib/file-history/workspace-watcher.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error("waitFor timeout")); }
    }, 50);
  });
}

describe("workspace watcher", () => {
  it("reports changes with workspace-relative posix paths and skips ignored dirs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-fh-watch-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "sub"));
    fs.mkdirSync(path.join(root, "node_modules"));

    const changed: string[] = [];
    const deleted: string[] = [];
    const watcher = createWorkspaceWatcher({
      root,
      onChanged: (relPath) => changed.push(relPath),
      onDeleted: (relPath) => deleted.push(relPath),
      onError: () => {},
    });
    cleanups.push(() => watcher.close());
    await watcher.ready;

    fs.writeFileSync(path.join(root, "sub", "a.md"), "hello");
    fs.writeFileSync(path.join(root, "node_modules", "noise.js"), "ignored");
    await waitFor(() => changed.includes("sub/a.md"));
    expect(changed).not.toContain("node_modules/noise.js");

    fs.rmSync(path.join(root, "sub", "a.md"));
    await waitFor(() => deleted.includes("sub/a.md"));
  }, 15_000);

  it("does not ignore dot-files while still pruning dot-directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-fh-watch-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, ".obsidian"));

    const changed: string[] = [];
    const watcher = createWorkspaceWatcher({
      root,
      onChanged: (relPath) => changed.push(relPath),
      onDeleted: () => {},
      onError: () => {},
    });
    cleanups.push(() => watcher.close());
    await watcher.ready;

    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
    fs.writeFileSync(path.join(root, ".obsidian", "app.json"), "{}");
    await waitFor(() => changed.includes(".gitignore"));
    expect(changed).not.toContain(".obsidian/app.json");
  }, 15_000);
});
