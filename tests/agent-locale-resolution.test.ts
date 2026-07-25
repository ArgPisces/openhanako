import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../core/agent.ts";

// config.yaml 里没有任何代码会写 locale 字段——缺失是常态。Agent.resolveLocale()
// 的语义链是 config.locale（显式覆盖）→ 全局 prefs 的 locale → "en"。
// 用 prompt 里恒定出现的用户档案标题（"# 用户档案" / "# User Profile"）当
// 语言探针，不依赖任何可选内容文件。

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-agent-locale-resolution-"));
  tempDirs.push(dir);
  return dir;
}

function makeAgent(locale?: string) {
  const root = makeTempDir();
  const agentsDir = path.join(root, "agents");
  const productDir = path.join(root, "product");
  const userDir = path.join(root, "user");
  fs.mkdirSync(path.join(agentsDir, "hana"), { recursive: true });
  fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(productDir, "yuan", "hanako.md"), "Yuan prompt", "utf-8");

  const agent = new Agent({ id: "hana", agentsDir, productDir, userDir } as any);
  agent._config = {
    // 真实 config.yaml 里没有任何代码会写 locale 字段；不传 locale 时省略这个
    // key（而不是写 locale: undefined），如实还原生产环境里"字段缺失"的现状。
    ...(locale !== undefined ? { locale } : {}),
    agent: { yuan: "hanako" },
    memory: { enabled: false },
    experience: { enabled: false },
  };
  agent.userName = (locale ?? "en").startsWith("zh") ? "用户" : "User";
  agent.agentName = "Hanako";
  return agent;
}

const FROZEN_TIME = new Date("2026-06-04T07:53:00.000Z");

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Agent locale resolution", () => {
  it("falls back to the global preferences locale when config.locale is absent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_TIME);
    const agent = makeAgent(); // config 里完全没有 locale 字段
    agent._cb = { getTimezone: () => "Asia/Shanghai", getLocale: () => "zh-CN" };

    const prompt = agent.buildSystemPrompt({
      forceMemoryEnabled: false,
      forceExperienceEnabled: false,
    });

    expect(prompt).toContain("# 用户档案");
    expect(prompt).not.toContain("# User Profile");
  });

  it("prefers an explicit config.locale over the global preferences locale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_TIME);
    const agent = makeAgent("en"); // 显式手工覆盖为 en
    agent._cb = { getTimezone: () => "Asia/Shanghai", getLocale: () => "zh-CN" };

    const prompt = agent.buildSystemPrompt({
      forceMemoryEnabled: false,
      forceExperienceEnabled: false,
    });

    expect(prompt).toContain("# User Profile");
    expect(prompt).not.toContain("# 用户档案");
  });

  it("falls back to en when neither config.locale nor the global preferences locale is set", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_TIME);
    const agent = makeAgent(); // config 无 locale
    agent._cb = { getTimezone: () => "Asia/Shanghai" }; // 无 getLocale 回调

    const prompt = agent.buildSystemPrompt({
      forceMemoryEnabled: false,
      forceExperienceEnabled: false,
    });

    expect(prompt).toContain("# User Profile");
    expect(prompt).not.toContain("# 用户档案");
  });
});
