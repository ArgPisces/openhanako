/** @type {import('../slash-command-registry.js').CommandDef[]} */
// 注意：reply 文案暂硬编码中文，和 session-ops.js 的 "[上下文已压缩]" 一致，
// 未来统一 slash 命令 i18n 时一并迁移到 t() 接口。
export const bridgeCommands = [
  {
    name: "stop",
    aliases: ["abort", "halt"],
    description: "中止当前正在进行的回复",
    scope: "session",
    permission: "owner",
    source: "core",
    handler: async (ctx) => {
      // abort 返回值即权威答案：true = 成功中断流，false = 无活动流可中断
      // 之前版本同时读 isStreaming 再判 && ok 是 TOCTOU + 冗余，已移除
      const ok = await ctx.sessionOps.abort(ctx.sessionRef);
      if (ok) return { silent: true };
      return { reply: "已停止（当前无活动回复）" };
    },
  },
  {
    name: "new",
    description: "开启新会话，历史归档",
    scope: "session",
    permission: "owner",
    source: "core",
    handler: async (ctx) => {
      // rotate 合约保证返回 {status}，不做防御性 ?. 以便契约破坏时立刻暴露
      const res = await ctx.sessionOps.rotate(ctx.sessionRef);
      if (res.status === "not-found") return { reply: "未找到当前会话" };
      if (res.status === "no-history") return { reply: "已开启新会话（之前无历史记录）" };
      return { reply: "已开启新会话，旧会话已归档" };
    },
  },
  {
    name: "reset",
    description: "彻底重置会话，清除历史",
    scope: "session",
    permission: "owner",
    source: "core",
    handler: async (ctx) => {
      // delete 合约同上，直接 res.status
      const res = await ctx.sessionOps.delete(ctx.sessionRef);
      if (res.status === "not-found") return { reply: "未找到当前会话" };
      return { reply: "已重置会话，历史已清除" };
    },
  },
  {
    name: "compact",
    description: "压缩当前会话上下文",
    scope: "session",
    permission: "owner",
    source: "core",
    handler: async (ctx) => {
      // Phase 7：bridge /compact 做真实压缩（session.compact()），并给用户发"进行中"+"完成/失败"两条消息
      // 让对方在社交平台看到"她在干活"的反馈，不用盯着一个沉默通道
      // 失败路径也要发一条给用户，否则压缩出错用户只会看到什么都没发生
      try { await ctx.reply("（正在压缩上下文，请稍候...）"); } catch {}
      try {
        const result = await ctx.sessionOps.compact(ctx.sessionRef);
        const before = result?.tokensBefore;
        const after = result?.tokensAfter;
        const msg = (typeof before === "number" && typeof after === "number")
          ? `（上下文已压缩：${before} → ${after} tokens）`
          : "（上下文已压缩）";
        try { await ctx.reply(msg); } catch {}
      } catch (err) {
        try { await ctx.reply(`（压缩失败：${err?.message || String(err)}）`); } catch {}
      }
      // 已经自己调 reply，走 silent 避免 dispatcher 再回复一次
      return { silent: true };
    },
  },
];
