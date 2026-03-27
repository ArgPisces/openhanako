import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PluginManager } from "../core/plugin-manager.js";

const tmpHome = path.join(os.tmpdir(), "hana-pm-test-" + Date.now());
const pluginsDir = path.join(tmpHome, "plugins");
const dataDir = path.join(tmpHome, "plugin-data");

beforeEach(() => {
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

async function makeBus() {
  const { EventBus } = await import("../hub/event-bus.js");
  return new EventBus();
}

describe("scan", () => {
  it("discovers plugin from directory with manifest.json", async () => {
    const dir = path.join(pluginsDir, "my-plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
      id: "my-plugin", name: "My Plugin", version: "1.0.0",
    }));
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    const plugins = pm.scan();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe("my-plugin");
    expect(plugins[0].name).toBe("My Plugin");
  });

  it("infers id from directory name when no manifest", async () => {
    const dir = path.join(pluginsDir, "simple-tool");
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "hello.js"),
      'export const name = "hello";\nexport const description = "test";\nexport const parameters = {};\nexport async function execute() { return "hi"; }\n');
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    const plugins = pm.scan();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe("simple-tool");
  });

  it("detects contribution types from subdirectories", async () => {
    const dir = path.join(pluginsDir, "multi");
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "t.js"), "export const name='t';");
    fs.writeFileSync(path.join(dir, "skills", "s.md"), "---\nname: s\n---\n# S");
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    const plugins = pm.scan();
    expect(plugins[0].contributions).toContain("tools");
    expect(plugins[0].contributions).toContain("skills");
  });

  it("skips hidden directories and non-directories", async () => {
    fs.mkdirSync(path.join(pluginsDir, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, "README.md"), "hi");
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    expect(pm.scan()).toHaveLength(0);
  });

  it("invalid manifest.json logs error and skips plugin", async () => {
    const dir = path.join(pluginsDir, "bad");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), "NOT JSON");
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    expect(pm.scan()).toHaveLength(0);
  });
});

describe("loadAll", () => {
  it("loads plugin with index.js and calls onload", async () => {
    const dir = path.join(pluginsDir, "stateful");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.js"), `
      export default class TestPlugin {
        async onload() { this.loaded = true; }
      }
    `);
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    pm.scan();
    await pm.loadAll();
    const entry = pm.getPlugin("stateful");
    expect(entry.status).toBe("loaded");
    expect(entry.instance.loaded).toBe(true);
  });

  it("provides register() on instance and cleans up on unload", async () => {
    const dir = path.join(pluginsDir, "reg-test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.js"), `
      export default class RegPlugin {
        async onload() {
          this.register(() => { globalThis.__regTestCleanup = true; });
        }
      }
    `);
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    pm.scan();
    await pm.loadAll();
    await pm.unloadPlugin("reg-test");
    expect(globalThis.__regTestCleanup).toBe(true);
    delete globalThis.__regTestCleanup;
  });

  it("failed onload marks plugin as failed, does not block others", async () => {
    const bad = path.join(pluginsDir, "bad-plugin");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, "index.js"), `
      export default class Bad { async onload() { throw new Error("boom"); } }
    `);
    const good = path.join(pluginsDir, "good-plugin");
    fs.mkdirSync(path.join(good, "tools"), { recursive: true });
    fs.writeFileSync(path.join(good, "tools", "t.js"), "export const name='t';");
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    pm.scan();
    await pm.loadAll();
    expect(pm.getPlugin("bad-plugin").status).toBe("failed");
    expect(pm.getPlugin("good-plugin").status).toBe("loaded");
  });

  it("plugin without index.js loads as static (no lifecycle)", async () => {
    const dir = path.join(pluginsDir, "static-only");
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "t.js"), "export const name='t';");
    const pm = new PluginManager({ pluginsDir, dataDir, bus: await makeBus() });
    pm.scan();
    await pm.loadAll();
    expect(pm.getPlugin("static-only").status).toBe("loaded");
    expect(pm.getPlugin("static-only").instance).toBeNull();
  });
});
