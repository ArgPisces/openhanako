import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../core/agent.ts";

// 用户名描述的是使用者本人，跨 agent 必须一致，所以正源是全局 preferences 的
// userName。Agent.resolveUserName() 的语义链与 resolveLocale() 同构：
// config.user.name（显式覆盖）→ 全局 prefs 的 userName → 按语言兜底
// （中文 "用户"，其余 "User"）。

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-agent-user-name-"));
  tempDirs.push(dir);
  return dir;
}

function makeAgent({ configUserName, locale }: { configUserName?: string; locale?: string } = {}) {
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
    ...(locale !== undefined ? { locale } : {}),
    ...(configUserName !== undefined ? { user: { name: configUserName } } : {}),
    agent: { yuan: "hanako" },
    memory: { enabled: false },
    experience: { enabled: false },
  };
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

describe("Agent user name resolution", () => {
  it("prefers an explicit config.user.name over the global preferences name", () => {
    const agent = makeAgent({ configUserName: "  阿黎  " });
    agent._cb = { getLocale: () => "zh-CN", getUserName: () => "全局名字" };

    expect(agent.resolveUserName()).toBe("阿黎");
  });

  it("falls back to the global preferences name when config.user.name is absent", () => {
    const agent = makeAgent();
    agent._cb = { getLocale: () => "zh-CN", getUserName: () => "全局名字" };

    expect(agent.resolveUserName()).toBe("全局名字");
  });

  it("falls back to a language-appropriate placeholder when neither source has a name", () => {
    const zh = makeAgent();
    zh._cb = { getLocale: () => "zh-CN", getUserName: () => "" };
    expect(zh.resolveUserName()).toBe("用户");

    const en = makeAgent();
    en._cb = { getLocale: () => "en", getUserName: () => "" };
    expect(en.resolveUserName()).toBe("User");
  });

  it("puts the globally configured name into the user profile section without any agent-level config", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_TIME);
    const agent = makeAgent();
    agent._cb = { getTimezone: () => "Asia/Shanghai", getLocale: () => "zh-CN", getUserName: () => "全局名字" };

    const prompt = agent.buildSystemPrompt({
      forceMemoryEnabled: false,
      forceExperienceEnabled: false,
    });

    expect(prompt).toContain("用户的名字叫：全局名字");
  });
});
