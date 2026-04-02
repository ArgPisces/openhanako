import { describe, expect, it, vi } from "vitest";
import { createSubagentTool } from "../lib/tools/subagent-tool.js";

describe("subagent-tool (sync await)", () => {
  it("awaits result and returns it as tool_result", async () => {
    const executeIsolated = vi.fn().mockResolvedValue({
      replyText: "分析结果：技术面看多",
      error: null,
    });

    const tool = createSubagentTool({
      executeIsolated,
      resolveUtilityModel: () => "utility-model",
      readOnlyBuiltinTools: ["read", "grep", "find", "ls"],
    });

    const result = await tool.execute("call_1", { task: "分析技术面" });

    expect(result).toEqual({
      content: [{ type: "text", text: "分析结果：技术面看多" }],
    });

    expect(executeIsolated).toHaveBeenCalledWith(
      expect.stringContaining("分析技术面"),
      expect.objectContaining({
        model: "utility-model",
        toolFilter: "*",
        builtinFilter: ["read", "grep", "find", "ls"],
      }),
    );
  });

  it("returns error message when execution fails", async () => {
    const executeIsolated = vi.fn().mockResolvedValue({
      replyText: "",
      error: "模型调用失败",
    });

    const tool = createSubagentTool({
      executeIsolated,
      resolveUtilityModel: () => "utility-model",
      readOnlyBuiltinTools: ["read"],
    });

    const result = await tool.execute("call_1", { task: "会失败的任务" });

    // t() 在测试环境返回 key
    expect(result.content[0].text).toContain("subagentFailed");
  });

  it("returns timeout message on abort", async () => {
    const executeIsolated = vi.fn().mockResolvedValue({
      replyText: "",
      error: "aborted",
    });

    const tool = createSubagentTool({
      executeIsolated,
      resolveUtilityModel: () => "utility-model",
      readOnlyBuiltinTools: ["read"],
    });

    const result = await tool.execute("call_1", { task: "超时任务" });

    expect(result.content[0].text).toContain("subagentTimeout");
  });

  it("catches thrown errors gracefully", async () => {
    const executeIsolated = vi.fn().mockRejectedValue(new Error("boom"));

    const tool = createSubagentTool({
      executeIsolated,
      resolveUtilityModel: () => "utility-model",
      readOnlyBuiltinTools: ["read"],
    });

    const result = await tool.execute("call_1", { task: "会抛异常的任务" });

    expect(result.content[0].text).toContain("subagentFailed");
  });

  it("rejects when concurrency limit (5) is reached", async () => {
    const releases = [];
    const executeIsolated = vi.fn().mockImplementation(() => new Promise((resolve) => {
      releases.push(() => resolve({ replyText: "ok", error: null }));
    }));

    const tool = createSubagentTool({
      executeIsolated,
      resolveUtilityModel: () => "utility-model",
      readOnlyBuiltinTools: ["read"],
    });

    // 同步启动 5 个（不 await，让它们 pending）
    const running = [];
    for (let i = 0; i < 5; i++) {
      running.push(tool.execute(`call_${i}`, { task: `任务 ${i}` }));
    }

    // 第 6 个应该被拒绝
    const blocked = await tool.execute("call_5", { task: "任务 5" });
    expect(blocked.content[0].text).toContain("subagentMaxConcurrent");

    // 释放全部 pending 任务
    for (const release of releases) release();
    await Promise.all(running);

    expect(executeIsolated).toHaveBeenCalledTimes(5);
  });
});
