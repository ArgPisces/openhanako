import { SlashCommandRegistry } from "../slash-command-registry.js";
import { SlashCommandDispatcher } from "../slash-command-dispatcher.js";
import { createSessionOps } from "./session-ops.js";
import { bridgeCommands } from "./bridge-commands.js";

export function createSlashSystem({ engine, hub }) {
  const registry = new SlashCommandRegistry();
  const sessionOps = createSessionOps({ engine });
  const dispatcher = new SlashCommandDispatcher({ registry, engine, hub, sessionOps });
  for (const def of bridgeCommands) registry.registerCommand(def);
  return { registry, dispatcher, sessionOps };
}

/**
 * 把 agent 的 runtime skills 映射为 slash 命令注册进 registry。
 * 幂等：同一 agentId 再次调用会先 unregister 旧的再注册新的，保证 skill 增/减同步到菜单。
 *
 * 一期语义：
 *   - desktop 场景：handler 通过 engine.promptSession 注入一段"调用 skill：<name>\n<args>"的 prompt
 *   - bridge 场景：handler 返回 silent 占位；实际 prompt 注入需要 bridge-manager 额外支持 __injectAsPrompt，
 *     留 Phase 5+ 接入。bridge 用户当前打 /<skillName> 会被静默拒绝——不是理想 UX 但不伤系统
 *
 * @param {{ registry: SlashCommandRegistry, engine: object, agentId: string }} opts
 */
export function exposeSkillsAsCommands({ registry, engine, agentId }) {
  if (!agentId) return;
  registry.unregisterBySource("skill", agentId);
  const list = (engine.getRuntimeSkills?.(agentId)) || [];
  for (const skill of list) {
    if (!skill || !skill.name) continue;
    if (skill.hidden || skill.enabled === false) continue;
    const skillName = skill.name;
    registry.registerCommand(
      {
        name: skillName,
        description: skill.description || `Run skill: ${skillName}`,
        scope: "session",
        permission: "owner",
        handler: async (ctx) => {
          const injectedPrompt = `调用 skill：${skillName}${ctx.args ? "\n" + ctx.args : ""}`;
          if (ctx.sessionRef.kind === "desktop" && typeof engine.promptSession === "function") {
            engine.promptSession(ctx.sessionRef.sessionPath, injectedPrompt);
            return { silent: true };
          }
          // bridge kind 或无 promptSession：一期占位，不做跨平台注入
          return { silent: true, __injectAsPrompt: injectedPrompt };
        },
      },
      { source: "skill", sourceId: agentId },
    );
  }
}
