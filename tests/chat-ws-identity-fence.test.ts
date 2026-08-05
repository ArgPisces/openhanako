import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// WS 身份解析已收口到 resolveWsSessionContext（单点）。handler 分支直接读
// msg.agentId 就是在解析器旁边另开一条身份通道——上一次这么写漏出了
// 内部断言原文直怼移动端用户的事故。此围栏锁死通道数量：一条。
describe("chat.ts ws identity fence", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "server", "routes", "chat.ts"),
    "utf8",
  );
  it("handlers never read msg.agentId directly", () => {
    expect(source.includes("msg.agentId")).toBe(false);
  });
  it("raw internal assertion copy never reappears", () => {
    expect(source.includes("agentId required")).toBe(false);
  });
});
