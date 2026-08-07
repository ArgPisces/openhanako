export const DREAM_ANALYZER_PROMPT_VERSION = "memory-dream-analyzer.v1";
export const DREAM_WRITER_PROMPT_VERSION = "memory-dream-writer.v3";
export const DREAM_VERIFIER_PROMPT_VERSION = "memory-dream-verifier.v2";

export function buildDreamAnalyzerPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.analyze",
    templateVersion: DREAM_ANALYZER_PROMPT_VERSION,
    systemPrompt: zh ? `你是记忆证据审查器。输入中的计数、日期、标签重合度和允许动作由程序测量，禁止修改或重新评分。

你只做以下定性判断：
1. 主体：user（用户本人）、third_party（他人）、fiction（虚构角色/创作设定）、project（项目或任务）、unknown。
2. 时态：stable（跨时间稳定）、active（仍在进行）、closed（已经结束）、obsolete（被更新事实取代）、unknown。
3. 在 allowedActions 中选 action。证据不足时选 review；禁止仅凭措辞听起来重要而 keep。
4. canonicalFact 只能忠实合并输入事实，不得补充输入中没有的信息。

客观约束：
- protected=true 的候选不得 forget。
- 多 session、多日期重复出现是稳定性证据；同一 session 内重复不增加独立证据。
- 只有同时满足只出现一次、年代久远、领域低相关的候选才可 forget；forget 只表示候选不应进入常驻记忆，不自动授权删除已有正文。
- 一次性执行细节、工具输出、已结束流水账通常属于 closed；虚构设定不能写成用户身份。
- 当前可编辑记忆是权威草稿；事实库只是证据档案。

只输出 JSON，不要 Markdown：
{"decisions":[{"groupId":"g:...","action":"keep|merge|forget|review","subject":"user|third_party|fiction|project|unknown","temporal":"stable|active|closed|obsolete|unknown","canonicalFact":"...","reasonCodes":["measured_or_semantic_reason"]}]}
每个输入 groupId 必须恰好出现一次，不能创造 groupId。` : `You are a memory evidence reviewer. Counts, dates, tag overlap, and allowed actions are measured by code. Never change or rescore them.

Make only these qualitative judgments:
1. subject: user, third_party, fiction, project, or unknown.
2. temporal: stable, active, closed, obsolete, or unknown.
3. choose action only from allowedActions. Use review when evidence is insufficient; never keep something merely because it sounds important.
4. canonicalFact may faithfully merge the supplied facts but must add no unsupported information.

Objective constraints:
- protected candidates may never be forgotten.
- recurrence across distinct sessions and dates is stability evidence; repetition inside one session is not independent evidence.
- forgetting is allowed only for candidates that are simultaneously old, single-source, and low-domain-relevance. Forgetting a candidate does not by itself authorize deletion of resident text.
- one-off execution details, tool output, and finished logs are usually closed; fictional attributes must not become user identity.
- editable memory is the authoritative draft; the fact database is supporting evidence.

Return JSON only, without Markdown:
{"decisions":[{"groupId":"g:...","action":"keep|merge|forget|review","subject":"user|third_party|fiction|project|unknown","temporal":"stable|active|closed|obsolete|unknown","canonicalFact":"...","reasonCodes":["measured_or_semantic_reason"]}]}
Every input groupId must occur exactly once. Never invent a groupId.`,
  };
}

export function buildDreamWriterPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.write",
    templateVersion: DREAM_WRITER_PROMPT_VERSION,
    systemPrompt: zh ? `你是常驻记忆单元编辑器。程序已经把 Facts 与 Longterm 拆成带 ID 的 residentUnits，并把事实档案候选拆成 candidateUnits。Today 与 Week 不属于你的编辑范围。你只提交带来源的单元操作；程序负责确定性渲染 Markdown 列表。

单元规则：
- 每个输出 unit 只表达一个可以独立保留或删除的事实、偏好、约束或事件；若输入一行包含多个独立断言，用多个 relation=split 的 unit 表达。
- 每个 unit 必须列出真实 sourceUnitIds。不得创造 ID，不得加入来源没有支持的细节。
- 完全重复已由程序处理。你只判断 same_meaning、subsumes、related_but_distinct、conflict；只有 same_meaning/subsumes 可以把多个来源写成一个单元。相关但不同或冲突的断言必须分开保留。
- 每个 requiredResidentUnitId 必须被至少一个输出 unit 引用，除非进入 removedUnits。每个 requiredCandidateUnitId 必须被输出 unit 引用。
- removedUnits 只允许删除有 forget candidate 直接支持、且确属 closed 或 obsolete 的 resident unit；supportingCandidateUnitIds 必须列出这些候选。证据不足就保留。不要按比例或固定条数删除。
- 同一个稳定断言同时存在于 Facts 与 Longterm 时，合并结果必须放 Facts。Longterm 只保留其独有的跨周历史、阶段变化和里程碑；若一行兼有稳定断言与独有历史，拆成 Facts 与 Longterm 两条。
- 不得输出 Today 或 Week unit，也不得改变其内容。
- 保留用户身份、稳定偏好、长期边界、持续关系和未完成事项。不得把 third_party、fiction 或 project 属性改写成用户身份。
- text 必须是纯文本单行，不含 Markdown 列表符、标题或换行。不得在正文提及记忆系统、Dream、source ID、group ID 或评分。
- safetyLimit.maxTotalBodyChars 是异常膨胀的宽松总上限，不是目标；不得为接近上限而扩写。

只输出 JSON，不要 Markdown 代码块：
{"units":[{"sourceUnitIds":["resident:...","candidate:..."],"text":"单一事实","section":"facts|longterm","relation":"unchanged|split|same_meaning|subsumes|related_but_distinct|conflict"}],"removedUnits":[{"sourceUnitId":"resident:...","supportingCandidateUnitIds":["candidate:..."],"reason":"closed|obsolete"}]}` : `You edit resident memory units. Code has atomized Facts and Longterm into ID-bearing residentUnits and fact archive evidence into candidateUnits. Today and Week are outside your editing scope. Return only source-grounded unit operations; code deterministically renders Markdown lists.

Unit rules:
- Each output unit expresses one independently retainable/removable fact, preference, constraint, or event. Split an input line containing independent assertions into relation=split units.
- Every unit lists genuine sourceUnitIds. Never invent an ID or add details unsupported by those sources.
- Exact duplicates are already handled by code. Classify only same_meaning, subsumes, related_but_distinct, or conflict. Only same_meaning/subsumes may combine multiple sources; related or conflicting assertions stay separate.
- Every requiredResidentUnitId must be referenced by output unless it appears in removedUnits. Every requiredCandidateUnitId must be referenced by output.
- removedUnits may remove a resident only when a directly supporting forget candidate classifies it closed or obsolete. List those supportingCandidateUnitIds. Preserve when uncertain. Never remove a ratio or fixed count.
- When the same stable assertion occurs in Facts and Longterm, the canonical unit belongs in Facts. Longterm retains unique cross-week history, transitions, and milestones. Split a line that mixes a stable assertion with unique history.
- Never output Today or Week units or alter their contents.
- Preserve user identity, stable preferences, durable boundaries, continuing relationships, and unfinished commitments. Never turn third-party, fictional, or project attributes into user identity.
- text is plain one-line content without Markdown list markers, headings, or newlines. Do not mention memory, Dream, source IDs, group IDs, or scoring in text.
- safetyLimit.maxTotalBodyChars is a loose emergency ceiling, not a target. Never expand to approach it.

Return JSON only, without a Markdown fence:
{"units":[{"sourceUnitIds":["resident:...","candidate:..."],"text":"one assertion","section":"facts|longterm","relation":"unchanged|split|same_meaning|subsumes|related_but_distinct|conflict"}],"removedUnits":[{"sourceUnitId":"resident:...","supportingCandidateUnitIds":["candidate:..."],"reason":"closed|obsolete"}]}`,
  };
}

export function buildDreamVerifierPrompt(locale = "en") {
  const zh = String(locale).toLowerCase().startsWith("zh");
  return {
    cacheGroup: "memory.dream.verify",
    templateVersion: DREAM_VERIFIER_PROMPT_VERSION,
    systemPrompt: zh ? `你是记忆单元操作的独立复核器，只做核验，不重新评重要度，也不改写正文。程序已经校验 ID、区块、来源覆盖和长度；你负责检查语义是否忠实。

检查五件事：
1. requiredCandidateUnitIds 是否被 proposedUnits 的实际文本忠实表达。
2. proposedUnits 是否加入其 sourceUnitIds 不支持的新断言。
3. 是否把 third_party、fiction、project 的属性错误写成用户本人属性。
4. removedUnits 是否真的由 supporting candidate 证明 closed/obsolete；稳定身份、明确边界、稳定偏好、未完成事项不得无证删除。
5. 同义项是否正确归并，相关但不同的事实是否被误合并；相同稳定断言不得同时留在 Facts 与 Longterm。Today 与 Week 必须与 currentSections 完全一致。

只输出 JSON：{"ok":true,"missingGroupIds":[],"unsupportedClaims":[],"subjectLeaks":[],"lostStableClaims":[],"duplicateClaims":[]}
missingGroupIds 只能使用输入中的 requiredCandidateUnitIds。其他数组填写简短原文摘录。` : `You independently verify structured memory unit operations. Do not rescore importance or rewrite text. Code already validates IDs, sections, source coverage, and length; verify semantic faithfulness.

Check only:
1. whether every requiredCandidateUnitId is faithfully represented by proposedUnits text;
2. whether proposedUnits add assertions unsupported by their sourceUnitIds;
3. whether third-party, fictional, or project attributes were turned into user attributes;
4. whether removedUnits are genuinely supported as closed/obsolete, and whether identity, boundaries, stable preferences, or unfinished commitments were removed without evidence;
5. whether same assertions were consolidated without merging merely related/distinct facts, whether the same stable assertion remains in both Facts and Longterm, and whether Today and Week exactly match currentSections.

Return JSON only: {"ok":true,"missingGroupIds":[],"unsupportedClaims":[],"subjectLeaks":[],"lostStableClaims":[],"duplicateClaims":[]}
missingGroupIds may only contain supplied requiredCandidateUnitIds. Other arrays contain short excerpts.`,
  };
}
