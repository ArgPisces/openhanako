/**
 * DeepSeek Responses 协议兼容层
 *
 * 处理 provider:
 *   - DeepSeek 官方 endpoint（provider 前缀 "deepseek" 或 baseUrl 含 "api.deepseek.com"）
 *   - 且 api === "openai-responses"
 *
 * 解决的协议问题：
 *   1. effort 枚举不同源：Pi SDK 的 OpenAIResponsesOptions.reasoningEffort 是
 *      minimal/low/medium/high/xhigh（OpenAI 枚举），DeepSeek 只认 high / max。
 *      DeepSeek 对不支持的取值静默忽略而非报错，不翻译就等于思考档位悄悄失效。
 *   2. 输出预算字段名：Responses 用 max_output_tokens，ChatCompletions 用 max_tokens。
 *      漏搬同样会被静默忽略，而 DeepSeek 在没收到预算时只给 4K 输出。注意这里
 *      只搬字段名，不改数值 —— 预算大小由 SDK 的 clampMaxTokensToContext 决定。
 *   3. ChatCompletions 残留字段：thinking / 顶层 reasoning_effort 只在 DeepSeek 的
 *      ChatCompletions 通道有效，发到 Responses 是无效噪声。
 *   4. 关思考：Responses 协议没有 thinking:{type:"disabled"} 的对应物，SDK 会退化成
 *      reasoning:{effort:"none"}，而 DeepSeek 只认 high / max。本模块选择整体删除
 *      reasoning 字段而不是发一个供应商不认识的档位（见下方"已知缺口"）。
 *
 *   官方文档：https://api-docs.deepseek.com/guides/responses_api/
 *
 * 已知缺口：
 *   DeepSeek Responses 通道目前没有公开的"关闭思考"开关。删除 reasoning 字段后由
 *   服务端决定默认行为，用户的 off 档位在这条通道上不保证生效。等官方补充关思考
 *   语义后，这里应改成显式发送对应字段。
 *
 * 删除条件：
 *   - DeepSeek Responses 接受 OpenAI 原生 effort 枚举（不再需要 high/max 翻译），
 *     且 Pi SDK 通过 model.thinkingLevelMap 完成映射
 *   - 或 hana 不再支持 DeepSeek Responses 通道
 *
 * 接口契约：见 ./README.md
 */

import {
  isThinkingUnsupportedByOutputLimit,
  resolveMissingThinkingBudget,
} from "./deepseek-thinking-budget.ts";

const RESPONSES_API = "openai-responses";
const OFFICIAL_DEEPSEEK_PROVIDERS = new Set(["deepseek", "deepseek-responses"]);

/** ChatCompletions 专属，发到 Responses 端点只会被静默忽略。 */
const CHAT_COMPLETIONS_ONLY_FIELDS = ["thinking", "reasoning_effort"];
/** Responses 端点的输出预算只认 max_output_tokens，其余同义字段需要搬运后删除。 */
const LEGACY_OUTPUT_CAP_FIELDS = ["max_tokens", "max_completion_tokens", "maxOutputTokens"];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function matches(model) {
  if (!model || typeof model !== "object") return false;
  if (lower(model.api) !== RESPONSES_API) return false;
  if (OFFICIAL_DEEPSEEK_PROVIDERS.has(lower(model.provider))) return true;
  // base_url: 兼容上游 SDK 偶发的 snake_case 别名（pi-ai SDK / 用户自定 model 配置）
  return lower(model.baseUrl || model.base_url).includes("api.deepseek.com");
}

function isThinkingOff(level) {
  return level === "off" || level === "none" || level === "disabled";
}

/**
 * DeepSeek Responses 只有 high / max 两档有效。SDK 送来的 OpenAI 枚举
 * （minimal/low/medium/high/xhigh）按语义就近归一，与 ChatCompletions 通道
 * 的 reasoningEffortForLevel 保持同一套映射。
 */
function translateEffort(effort) {
  const normalized = lower(effort);
  if (!normalized) return null;
  if (isThinkingOff(normalized)) return null;
  if (normalized === "xhigh" || normalized === "max") return "max";
  return "high";
}

/**
 * 解析本次请求最终要发的 max_output_tokens：只做字段搬运，不改数值。
 *
 * 预算大小由 SDK 的 clampMaxTokensToContext 决定（`min(模型输出上限,
 * 剩余窗口 - 安全余量)`），兼容层不覆盖 —— 它拿不到真实 token 数，覆盖只会
 * 在剩余窗口紧张时把请求推过窗口边界。
 */
function resolveOutputCap(payload) {
  const explicit = positiveInteger(payload.max_output_tokens);
  if (explicit) return explicit;
  for (const field of LEGACY_OUTPUT_CAP_FIELDS) {
    const value = positiveInteger(payload[field]);
    if (value) return value;
  }
  return null;
}

export function apply(payload, model, options: Record<string, any> = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  // 模型输出上限撑不起思考链时关掉思考（与 ChatCompletions 通道同规则）。
  const thinkingDisabled = options.mode === "utility"
    || isThinkingOff(options.reasoningLevel)
    || isThinkingUnsupportedByOutputLimit(model);
  // 供应商收不到预算时只给 4K，思考模式下正文出不来，仅在完全没有预算时兜底。
  const resolvedCap = resolveOutputCap(payload);
  const outputCap = resolvedCap === null && !thinkingDisabled
    ? resolveMissingThinkingBudget(model)
    : resolvedCap;
  const nextReasoning = thinkingDisabled
    ? null
    : (() => {
      if (!payload.reasoning || typeof payload.reasoning !== "object") return null;
      const effort = translateEffort(payload.reasoning.effort);
      if (!effort) return null;
      return effort === payload.reasoning.effort
        ? payload.reasoning
        : { ...payload.reasoning, effort };
    })();
  const staleFields = [
    ...CHAT_COMPLETIONS_ONLY_FIELDS,
    ...LEGACY_OUTPUT_CAP_FIELDS,
  ].filter((field) => hasOwn(payload, field));

  const reasoningChanged = hasOwn(payload, "reasoning")
    ? nextReasoning !== payload.reasoning
    : nextReasoning !== null;
  const outputCapChanged = outputCap !== null
    && positiveInteger(payload.max_output_tokens) !== outputCap;

  if (!staleFields.length && !reasoningChanged && !outputCapChanged) return payload;

  const next = { ...payload };
  for (const field of staleFields) delete next[field];
  if (outputCap !== null) next.max_output_tokens = outputCap;
  if (nextReasoning) next.reasoning = nextReasoning;
  else delete next.reasoning;

  return next;
}
