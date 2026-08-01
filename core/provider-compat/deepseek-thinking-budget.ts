/**
 * DeepSeek 思考模式的输出预算档位
 *
 * DeepSeek 的思考链和正文共用一份输出预算。预算给小了，思考链会把额度吃光，
 * 正文被截断；给到顶格又会在长上下文里挤压输入空间。这套档位是两条官方通道
 * （ChatCompletions / Responses）共享的厂商级事实，放在这里避免双源真相。
 *
 * 档位语义：
 *   - FLOOR：思考模式下的最小可用预算。低于这个值说明调用方没有真正给预算，
 *     需要抬升；高于则视为调用方的明确意图，不再改写。
 *   - high 档保持保守值：思考深度中等，顶格申请只会挤压长对话的输入空间。
 *   - max 档顶格到模型上限：用户明确选了最深思考，长输出就是意图本身。
 *
 * 官方文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 */

/** 思考模式下的最小可用输出预算，低于此值视为调用方未给预算。 */
export const DEEPSEEK_THINKING_BUDGET_FLOOR = 32768;

const DEEPSEEK_HIGH_SAFE_MAX_TOKENS = 65536;
const DEEPSEEK_MAX_SAFE_MAX_TOKENS = 384000;

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * 解析该 effort 档位下应申请的输出预算，受模型自身上限约束。
 *
 * @param {object|null|undefined} model
 * @param {string|null|undefined} effort — 已翻译成 DeepSeek 枚举的 effort（high / max）
 * @returns {number}
 */
export function resolveThinkingOutputBudget(model, effort) {
  const modelLimit = positiveInteger(model?.maxTokens || model?.maxOutput);
  const desired = effort === "max"
    ? DEEPSEEK_MAX_SAFE_MAX_TOKENS
    : DEEPSEEK_HIGH_SAFE_MAX_TOKENS;
  return modelLimit ? Math.min(modelLimit, desired) : desired;
}
