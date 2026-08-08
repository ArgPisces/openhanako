export const DREAM_ATOMIZER_PROMPT_VERSION = "memory-dream-atomizer.v1";
export const DREAM_DEDUPER_PROMPT_VERSION = "memory-dream-deduper.v1";
export const DREAM_OPTIMIZER_PROMPT_VERSION = "memory-dream-optimizer.v1";
export const DREAM_VERIFIER_PROMPT_VERSION = "memory-dream-verifier.v3";

export function buildDreamAtomizerPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.atomize",
    templateVersion: DREAM_ATOMIZER_PROMPT_VERSION,
    systemPrompt: zh ? `你是常驻记忆原子化器。输入只包含当前 Facts 与 Longterm 的 sourceBlocks，不包含事实数据库、Today 或 Week。

这个阶段只负责拆分：
- 每个输出 unit 只表达一个可以独立保留、删除或更新的事实、偏好、约束、关系、事件或阶段变化。
- 一段中有多个独立断言时必须拆成多个 unit。长句中的身份、偏好、项目、经历不能挤在同一条。
- 每个 unit 只能引用一个真实 sourceBlockId，并保持原 section。
- 必须覆盖每个 sourceBlockId，不能删除、合并或漏掉原意。
- 可以补足必要主语使条目自足，但不得优化措辞、推断、概括或增加来源没有的信息。
- text 必须是 240 字符以内的纯文本单行，不含 Markdown 标记和换行；一条中不得出现两个完整句子。

只输出 JSON：
{"units":[{"sourceBlockId":"source:facts:0","section":"facts|longterm","text":"一个原子断言"}]}` : `You atomize resident memory. Input contains only sourceBlocks from the current Facts and Longterm sections, never a fact database, Today, or Week.

This stage only splits:
- Each output unit expresses one independently retainable, removable, or updatable fact, preference, constraint, relationship, event, or transition.
- Split every block containing independent assertions. Do not pack identity, preferences, projects, and history into one unit.
- Each unit references exactly one genuine sourceBlockId and stays in its source section.
- Cover every sourceBlockId. Never delete, merge, or omit source meaning.
- You may restore a necessary subject so a unit stands alone, but never optimize, infer, summarize, or add unsupported information.
- text is plain one-line content, at most 240 characters, without Markdown markers or multiple complete sentences.

Return JSON only:
{"units":[{"sourceBlockId":"source:facts:0","section":"facts|longterm","text":"one atomic assertion"}]}`,
  };
}

export function buildDreamDeduperPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.dedupe",
    templateVersion: DREAM_DEDUPER_PROMPT_VERSION,
    systemPrompt: zh ? `你是常驻记忆去重器。输入只包含已经原子化的当前 Facts 与 Longterm；程序已经删除完全相同的文本。你只判断语义重复，不改写正文，也不决定遗忘。

对每个输入 unit 恰好归组一次：
- distinct：只有一个 sourceUnitId，表示没有可合并的重复。
- same_meaning：至少两个来源表达同一件事，仅措辞不同。
- subsumes：至少两个来源中，一个完整包含其他来源的全部有效信息。
- 仅仅相关、同一主题、同一项目、时间相近或存在冲突，都必须各自作为 distinct，不能合并。
- Facts 与 Longterm 重复时无需决定落点，程序会确定性地让 Facts 胜出。
- 不得创造 ID，不得把不同事实为了缩短而合并。

只输出 JSON：
{"groups":[{"sourceUnitIds":["atom:0"],"relation":"distinct|same_meaning|subsumes"}]}` : `You deduplicate already-atomized current Facts and Longterm memory. Exact text duplicates are already removed. Classify semantic duplication only; do not rewrite content or decide forgetting.

Cover every input unit exactly once:
- distinct: exactly one sourceUnitId with no mergeable duplicate.
- same_meaning: at least two sources state the same assertion in different words.
- subsumes: at least two sources where one fully contains all useful information in the others.
- Merely related, same-topic, same-project, temporally close, or conflicting assertions must remain separate distinct groups.
- Code deterministically prefers Facts when a duplicate spans Facts and Longterm.
- Never invent IDs or combine different facts merely to shorten memory.

Return JSON only:
{"groups":[{"sourceUnitIds":["atom:0"],"relation":"distinct|same_meaning|subsumes"}]}`,
  };
}

export function buildDreamOptimizerPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.optimize",
    templateVersion: DREAM_OPTIMIZER_PROMPT_VERSION,
    systemPrompt: zh ? `你是常驻记忆优化器。输入只包含从当前 Facts 与 Longterm 拆分、去重后得到的 groups，不包含事实数据库、Today 或 Week。每个 group 必须恰好保留或删除一次。

保留时：
- 用一条简洁、自足、忠实的单行文本表达 group 的全部有效信息。
- 不得加入来源没有的身份、偏好、时间、因果、状态或评价。
- 保持程序给定 section，不重新分类。
- 保留用户身份、稳定偏好、长期边界、持续关系、独特经历、重要阶段变化和未完成事项。
- text 不超过 240 字符，不含 Markdown 标记、换行或多个完整句子。

删除只能使用三种客观理由：
- completed_transient：文本本身明确是已经结束的一次性执行步骤或流水账，且没有留下长期结果。
- obsolete：同一份当前记忆中有明确的新状态取代它。
- operational_noise：纯工具输出、报错、路径、临时排期或实现噪音，不描述用户或项目的持续状态。

证据不足一律保留。不得按比例、条数、年代或“听起来不重要”删除。不得删除稳定身份、偏好、边界、关系、健康信息、独特经历或未完成事项。安全上限只是灾难兜底，不是扩写目标。

只输出 JSON：
{"units":[{"groupId":"group:0","section":"facts|longterm","text":"优化后的原子记忆"}],"removedGroups":[{"groupId":"group:1","reason":"completed_transient|obsolete|operational_noise"}]}` : `You optimize groups produced solely by splitting and deduplicating the current Facts and Longterm memory. No fact database, Today, or Week is present. Every group must be retained or removed exactly once.

When retaining:
- Express all useful group meaning as one concise, self-contained, faithful line.
- Add no unsupported identity, preference, time, causality, status, or evaluation.
- Keep the code-assigned section.
- Preserve identity, stable preferences, durable boundaries, continuing relationships, unique experiences, important transitions, and unfinished commitments.
- text is at most 240 characters, with no Markdown markers, newline, or multiple complete sentences.

Removal is allowed only for these objective reasons:
- completed_transient: the text itself clearly describes a finished one-off execution step or log with no durable outcome.
- obsolete: a newer state in this same current memory explicitly replaces it.
- operational_noise: pure tool output, error, path, temporary scheduling, or implementation noise that states no durable user or project condition.

Preserve when uncertain. Never delete by ratio, count, age alone, or subjective importance. Never delete identity, stable preferences, boundaries, relationships, health information, unique experiences, or unfinished work. The safety ceiling is an emergency guard, not a writing target.

Return JSON only:
{"units":[{"groupId":"group:0","section":"facts|longterm","text":"optimized atomic memory"}],"removedGroups":[{"groupId":"group:1","reason":"completed_transient|obsolete|operational_noise"}]}`,
  };
}

export function buildDreamVerifierPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.verify",
    templateVersion: DREAM_VERIFIER_PROMPT_VERSION,
    systemPrompt: zh ? `你是三阶段常驻记忆整理的独立复核器，只核验，不改写正文或重新分组。

检查：
1. atomization 是否把 sourceBlocks 的原意完整拆开，有无遗漏或把多个独立断言塞进一条。
2. dedupe 是否只合并 same_meaning/subsumes，有无误合并仅相关、不同或冲突的事实。
3. optimizedUnits 是否加入任何来源不支持的新断言，或把他人、虚构角色、项目属性写成用户属性。
4. removedGroups 是否严格属于 completed_transient、obsolete 或 operational_noise，有无删除稳定身份、偏好、边界、关系、健康、独特经历或未完成事项。
5. 最终是否仍有语义重复；Today 与 Week 是否与 currentSections 完全一致。

只输出 JSON：
{"ok":true,"missingClaims":[],"compoundUnits":[],"incorrectMerges":[],"unsupportedClaims":[],"subjectLeaks":[],"unsafeRemovals":[],"duplicateClaims":[]}` : `You independently verify a three-stage resident-memory cleanup. Verify only; do not rewrite or regroup.

Check:
1. atomization fully covers sourceBlocks and does not pack independent assertions into one unit;
2. dedupe merges only same_meaning/subsumes, never merely related, different, or conflicting facts;
3. optimizedUnits add no unsupported claim and never turn third-party, fictional, or project attributes into user attributes;
4. removedGroups strictly qualify as completed_transient, obsolete, or operational_noise, without deleting identity, stable preferences, boundaries, relationships, health, unique experiences, or unfinished work;
5. no semantic duplicates remain, and Today and Week exactly equal currentSections.

Return JSON only:
{"ok":true,"missingClaims":[],"compoundUnits":[],"incorrectMerges":[],"unsupportedClaims":[],"subjectLeaks":[],"unsafeRemovals":[],"duplicateClaims":[]}`,
  };
}
