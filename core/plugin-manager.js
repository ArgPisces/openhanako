import fs from "fs";
import path from "path";
import { createPluginContext } from "./plugin-context.js";

const KNOWN_CONTRIBUTION_DIRS = [
  "tools", "routes", "skills", "hooks", "agents", "commands", "providers",
];

export class PluginManager {
  constructor({ pluginsDir, dataDir, bus }) {
    this._pluginsDir = pluginsDir;
    this._dataDir = dataDir;
    this._bus = bus;
    this._plugins = new Map();
    this._scanned = [];
    this.routeRegistry = new Map();
  }

  scan() {
    if (!fs.existsSync(this._pluginsDir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(this._pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const pluginDir = path.join(this._pluginsDir, entry.name);
      try {
        const desc = this._readPluginDescriptor(pluginDir, entry.name);
        results.push(desc);
      } catch (err) {
        console.error(`[plugin-manager] failed to read plugin "${entry.name}":`, err.message);
      }
    }
    this._scanned = results;
    return results;
  }

  _readPluginDescriptor(pluginDir, dirName) {
    const manifestPath = path.join(pluginDir, "manifest.json");
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    }
    const id = manifest?.id || dirName;
    const name = manifest?.name || dirName;
    const version = manifest?.version || "0.0.0";
    const description = manifest?.description || "";
    const contributions = [];
    for (const dir of KNOWN_CONTRIBUTION_DIRS) {
      if (fs.existsSync(path.join(pluginDir, dir))) contributions.push(dir);
    }
    if (fs.existsSync(path.join(pluginDir, "hooks.json"))) contributions.push("hooks");
    if (fs.existsSync(path.join(pluginDir, "index.js"))) contributions.push("lifecycle");
    return { id, name, version, description, pluginDir, manifest, contributions };
  }

  async loadAll() {
    const descriptors = this._scanned.length > 0 ? this._scanned : this.scan();
    for (const desc of descriptors) {
      const entry = { ...desc, status: "loading", instance: null, _disposables: [] };
      this._plugins.set(desc.id, entry);
      try {
        await this._loadPlugin(entry);
        entry.status = "loaded";
      } catch (err) {
        entry.status = "failed";
        entry.error = err.message;
        console.error(`[plugin-manager] plugin "${desc.id}" failed to load:`, err.message);
      }
    }
  }

  async _loadPlugin(entry) {
    const indexPath = path.join(entry.pluginDir, "index.js");
    if (!fs.existsSync(indexPath)) return;
    const mod = await import(indexPath);
    const PluginClass = mod.default;
    if (!PluginClass || typeof PluginClass !== "function") return;
    const instance = new PluginClass();
    entry.instance = instance;
    instance.ctx = createPluginContext({
      pluginId: entry.id,
      pluginDir: entry.pluginDir,
      dataDir: path.join(this._dataDir, entry.id),
      bus: this._bus,
    });
    instance.register = (disposable) => {
      if (typeof disposable === "function") entry._disposables.push(disposable);
    };
    if (typeof instance.onload === "function") await instance.onload();
  }

  async unloadPlugin(pluginId) {
    const entry = this._plugins.get(pluginId);
    if (!entry) return;
    if (entry.instance) {
      if (typeof entry.instance.onunload === "function") {
        try { await entry.instance.onunload(); } catch (err) {
          console.error(`[plugin-manager] "${pluginId}" onunload error:`, err.message);
        }
      }
      for (const d of entry._disposables.reverse()) {
        try { d(); } catch (err) {
          console.error(`[plugin-manager] "${pluginId}" disposable error:`, err.message);
        }
      }
      entry._disposables = [];
    }
    this.routeRegistry.delete(pluginId);
    entry.status = "unloaded";
  }

  getPlugin(id) { return this._plugins.get(id) || null; }
  listPlugins() { return [...this._plugins.values()]; }
}
