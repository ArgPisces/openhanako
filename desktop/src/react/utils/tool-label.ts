/**
 * 工具行文案解析。
 *
 * 进程区每条工具调用只有这一个取值点，键形如 `tool.<工具名>.<相位>`。
 * 工具名对不上就静默落到兜底文案，运行时不报错，所以内置名单和语言包的一致性
 * 由 tests/tool-label-coverage.test.ts 对账守住。
 */

import type { ToolCall } from '../stores/chat-types';

export type ToolPhase = 'running' | 'done' | 'failed';
export type ToolStatus = NonNullable<ToolCall['status']>;

/** 这两个工具复用别的工具的文案。 */
export const TOOL_LABEL_ALIASES: Record<string, string> = {
  exec_command: 'bash',
  write_stdin: 'terminal',
};

/**
 * 一方工具名。插件工具由 PluginManager 注册成 `<pluginId>_<tool>`，MCP 工具是
 * `mcp_<tool>`，都不在这张表里，因此查不到专属文案时能落到插件兜底而不是通用兜底。
 *
 * 不走"剥掉前缀再查一次"那条捷径：第三方插件里叫 read / write 的工具会直接撞上
 * 内置工具的文案，把别人干的事说成是读写本地文件。
 *
 * 后端哪天在工具调用事件里带上 pluginId，这张表连同 isExternalTool 就能整块删掉。
 */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read', 'write', 'edit', 'grep', 'find', 'ls', 'bash', 'terminal', 'materialize',
  'exec_command', 'write_stdin',
  'search_memory', 'pin_memory', 'unpin_memory', 'recall_experience', 'record_experience',
  'web_search', 'web_fetch', 'todo_write', 'automation', 'stage_files', 'file', 'channel',
  'browser', 'computer', 'install_skill', 'notify', 'stop_task', 'update_settings',
  'session_folders', 'subagent', 'subagent_reply', 'subagent_close', 'workflow',
  'check_pending_tasks', 'loop_control', 'current_status', 'session',
  'hana_card_guide', 'show_card',
  'channel_read_context', 'channel_reply', 'channel_pass',
  'create_artifact', 'dm',
]);

export function isExternalTool(name: string): boolean {
  return !BUILTIN_TOOL_NAMES.has(name) && name.includes('_');
}

function resolveToolCopy(key: string, phase: ToolPhase, vars: Record<string, string>): string | null {
  const path = `tool.${key}.${phase}`;
  const value = window.t?.(path, vars);
  return value && value !== path ? value : null;
}

export function getToolLabel(name: string, phase: ToolPhase, agentName: string): string {
  const vars = { name: agentName };
  const key = TOOL_LABEL_ALIASES[name] ?? name;
  return resolveToolCopy(key, phase, vars)
    ?? (isExternalTool(name) ? resolveToolCopy('_plugin', phase, vars) : null)
    ?? resolveToolCopy('_fallback', phase, vars)
    ?? name;
}

/** unknown 归到 done：工具已经不转了，说"正在忙碌"会一直挂着。 */
export function phaseForStatus(status: ToolStatus): ToolPhase {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'done';
}
