/**
 * DeepSeek 思考模式的输出预算下限
 *
 * DeepSeek 的思考链和正文共用一份输出预算（reasoning_content 计入输出 token），
 * 而输入和输出又共用同一个上下文窗口。预算给小了思考链会把额度吃光、正文出不来；
 * 给大了会挤爆总窗口让请求直接失败。
 *
 * **这里不负责决定已有预算的大小。** Pi SDK 的 clampMaxTokensToContext 已经按
 * `min(模型输出上限, 剩余窗口 - 安全余量)` 算好了，它掌握 payload 层拿不到的
 * 真实 token 数。兼容层只做协议翻译，不覆盖这个值 —— 覆盖只会在剩余窗口本来
 * 就紧张时把请求推过窗口边界。思考档位决定想多深，剩余窗口决定能多长，两个
 * 正交的维度不该互相绑定。
 *
 * 保留两个判断：
 *   1. 模型自身的输出上限就撑不起思考链时关掉思考，把额度让给正文。依据是模型
 *      能力而不是单次请求的剩余预算 —— 前者静态可预期，后者会让同一个模型在长
 *      对话里突然不思考了，那是用户没法预料的静默降级。
 *   2. 请求完全没带预算时补一个兜底值，否则供应商只给 4K。
 *
 * 官方文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 */

/** 思考模式可用的最小输出上限。模型上限低于此值时，思考链会吃光正文空间。 */
export const DEEPSEEK_THINKING_BUDGET_FLOOR = 32768;

/**
 * 请求完全没带输出预算时的兜底值。
 *
 * DeepSeek 在收不到预算时只给 4K 输出，思考链一开就把正文挤没了。这里给一个
 * 够用又不顶格的值：顶格需要知道剩余窗口，而走到这条分支恰恰说明上游没算过。
 */
const DEEPSEEK_MISSING_BUDGET_FALLBACK = 65536;

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * 请求没带输出预算时该补上的值。已有预算的请求不该调用这里。
 *
 * @param {object|null|undefined} model
 * @returns {number}
 */
export function resolveMissingThinkingBudget(model) {
  const modelLimit = positiveInteger(model?.maxTokens || model?.maxOutput);
  return modelLimit
    ? Math.min(modelLimit, DEEPSEEK_MISSING_BUDGET_FALLBACK)
    : DEEPSEEK_MISSING_BUDGET_FALLBACK;
}

/**
 * 模型的输出上限是否撑不起思考模式。
 *
 * @param {object|null|undefined} model
 * @returns {boolean} 模型未声明输出上限时返回 false（不替供应商做决定）
 */
export function isThinkingUnsupportedByOutputLimit(model) {
  const modelLimit = positiveInteger(model?.maxTokens || model?.maxOutput);
  return modelLimit !== null && modelLimit <= DEEPSEEK_THINKING_BUDGET_FLOOR;
}
