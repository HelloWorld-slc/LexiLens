import { currentText, decodeJson, uid } from "./core.mjs";

export const kinds = {
  reading: "阅读选择",
  cloze: "完形填空",
  word_bank: "选词填空",
  grammar: "语法填空",
  completion: "句子／段落补全",
  short_answer: "阅读简答",
  translation: "翻译",
  judgment: "判断（通用）",
  matching: "匹配（通用）",
  unknown: "其他／待确认",
};
export const responses = {
  single: "单选",
  multiple: "多选",
  blanks: "逐空填写",
  text: "文字作答",
  matching: "逐项匹配",
};
export const relations = {
  supported: "原文直接支持",
  contradicted: "与原文矛盾",
  unmentioned: "原文未提及",
  inference: "结合信息推断",
  insufficient: "材料不足",
};
export const bases = {
  evidence: "原文证据",
  rule: "语言规则",
  inference: "模型推断",
  translation: "参考译法",
};
export const colors = [
  "#3985d9",
  "#d27824",
  "#8b63d1",
  "#24917c",
  "#bd5087",
  "#7e8030",
];
const require = (ok, message) => {
  if (!ok) throw Error(message);
};
const str = (x) => typeof x === "string";
const list = (x) => Array.isArray(x);
function unique(rows, label) {
  require(list(rows) &&
    rows.every((x) => x && str(x.id) && x.id.length && /^[\w-]+$/.test(x.id)) &&
    new Set(rows.map((x) => x.id)).size ===
      rows.length, `${label}编号缺失、重复或无效`);
}
export function material(article) {
  return article.paragraphs.map((p) => ({
    articleId: article.id,
    paragraphId: p.id,
    versionId: p.currentVersion,
    kind: p.kind,
    text: currentText(p),
  }));
}
export function locate(ref, paragraphs) {
  const p = paragraphs.find(
    (p) =>
      p.articleId === ref?.articleId &&
      p.paragraphId === ref.paragraphId &&
      p.versionId === ref.versionId,
  );
  require(p &&
    str(ref.quote) &&
    ref.quote.trim(), "引用不存在、所属材料错误或版本已改变");
  let start = ref.start;
  if (!Number.isInteger(start)) {
    start = p.text.indexOf(ref.quote);
    require(start >= 0 &&
      p.text.indexOf(ref.quote, start + 1) <
        0, "引用不存在或重复，请指定准确位置");
  }
  require(start >= 0 &&
    p.text.slice(start, start + ref.quote.length) ===
      ref.quote, "引用文字与位置不符");
  return { ...ref, start, end: start + ref.quote.length };
}
export function isCurrent(group, article) {
  if (group.articleId !== article.id) return false;
  const current = material(article);
  return (
    group.material.every((p) =>
      current.some(
        (c) =>
          c.paragraphId === p.paragraphId &&
          c.versionId === p.versionId &&
          c.text === p.text,
      ),
    ) && current.length === group.material.length
  );
}
export function optionPool(group, item) {
  return item.options.length ? item.options : group.options;
}
export function issues(group, item) {
  const out = [...(item.uncertainties || [])];
  if (!item.number) out.push("题号缺失，未补造");
  if (item.kind === "unknown") out.push("题型待人工确认，使用通用作答");
  if (
    ["single", "multiple", "matching"].includes(item.response) &&
    optionPool(group, item).length < 2
  )
    out.push("选项可能不完整，请核对原图");
  if (
    ["cloze", "word_bank", "grammar", "completion"].includes(item.kind) &&
    !item.blanks.length
  )
    out.push("未确定空位，请补充后作答");
  if (item.blanks.some((b) => !b.location)) out.push("部分空位尚未绑定位置");
  if (
    item.kind === "translation" &&
    (!item.translation ||
      item.translation.direction === "unknown" ||
      item.translation.unit === "unknown")
  )
    out.push("翻译方向或范围待确认");
  return [...new Set(out)];
}
export function validateGroups(raw, article) {
  const data = str(raw) ? decodeJson(raw) : structuredClone(raw);
  const paragraphs = material(article);
  unique(data.groups, "题组");
  require(data.groups.length > 0, "没有识别到题组，请手动添加");
  const allIds = new Set();
  for (const g of data.groups) {
    require(g.articleId === article.id &&
      str(g.title) &&
      str(g.instructions) &&
      str(g.raw), "题组缺少所属文章或原文说明");
    require(list(g.sources) &&
      (g.sources.length || g.manual === true), "题组必须保留来源");
    g.sources = g.sources.map((r) => locate(r, paragraphs));
    unique(g.options, "共享选项");
    unique(g.items, "子题");
    require(g.items.length, "题组没有子题");
    for (const o of g.options)
      require(str(o.text) && str(o.label), "选项缺少字母或内容");
    require(["yes", "no", "unknown"].includes(g.reuse) &&
      ["yes", "no", "unknown"].includes(
        g.inflect,
      ), "词库使用规则必须明确或标为未知");
    for (const q of g.items) {
      require(!allIds.has(q.id), "子题编号跨题组重复");
      allIds.add(q.id);
      require(Object.hasOwn(kinds, q.kind) &&
        Object.hasOwn(responses, q.response), "题型或作答方式无效");
      require(str(q.stem) &&
        str(q.number) &&
        str(q.requirements) &&
        list(q.uncertainties) &&
        q.uncertainties.every(str), "题干、要求或不确定性格式错误");
      unique(q.options, "选项");
      unique(q.blanks, "空位");
      for (const o of q.options)
        require(str(o.text) && str(o.label), "选项缺少字母或内容");
      for (const b of q.blanks) {
        require(str(b.label) && str(b.hint), "空位缺少标记或提示词");
        if (b.location) b.location = locate(b.location, paragraphs);
      }
      if (q.kind === "translation")
        require(q.translation &&
          ["en_zh", "zh_en", "unknown"].includes(q.translation.direction) &&
          ["word", "phrase", "sentence", "unknown"].includes(
            q.translation.unit,
          ) &&
          ["yes", "no", "unknown"].includes(
            q.translation.useSource,
          ), "翻译方向、范围或原文要求缺失");
      require(list(q.sources), "题目关联必须为列表");
      q.sources = q.sources.map((r) => locate(r, paragraphs));
      // Model answers are never accepted into the recognition structure.
      for (const key of Object.keys(q))
        if (
          ![
            "id",
            "number",
            "kind",
            "response",
            "stem",
            "requirements",
            "options",
            "blanks",
            "translation",
            "sources",
            "uncertainties",
          ].includes(key)
        )
          delete q[key];
    }
    g.material = structuredClone(paragraphs);
    g.versionId = uid();
  }
  return data.groups;
}
export function requestInput(group, item, article) {
  return {
    schema: 1,
    group: {
      id: group.id,
      versionId: group.versionId,
      articleId: group.articleId,
      instructions: group.instructions,
      options: group.options,
      reuse: group.reuse,
      inflect: group.inflect,
    },
    item,
    paragraphs: material(article),
    title: article.title,
  };
}
export function cacheMatch(row, task, input, model) {
  return (
    row.task === task &&
    row.model === model &&
    row.promptVersion === 1 &&
    JSON.stringify(row.input) === JSON.stringify(input) &&
    !!row.data
  );
}
export function validateHelp(raw, input, task) {
  const data = str(raw) ? decodeJson(raw) : structuredClone(raw),
    q = input.item;
  require(data.itemId === q.id, "解答不属于当前题");
  if (task === "worksheet-feedback") {
    require([
      "meaning",
      "grammar",
      "requirement",
      "wording",
      "acceptable",
      "undetermined",
    ].includes(data.category) &&
      str(data.feedback) &&
      str(data.reason), "参考反馈字段不完整");
    require(list(data.citations), "反馈缺少来源列表");
    data.citations = data.citations.map((r) => locate(r, input.paragraphs));
    return data;
  }
  require(str(data.hint) &&
    str(data.answer) &&
    str(data.explanation) &&
    typeof data.uncertain === "boolean" &&
    list(data.parts) &&
    list(data.options) &&
    list(data.points), "参考解答结构不完整");
  const validateBasis = (p) => {
    require(Object.hasOwn(bases, p.basis) &&
      str(p.text) &&
      list(p.citations), "依据类型或说明缺失");
    p.citations = p.citations.map((r) => locate(r, input.paragraphs));
    require(p.basis !== "evidence" ||
      p.citations.length, "原文证据缺少真实引用");
  };
  data.points.forEach(validateBasis);
  unique(data.parts, "空位解答");
  require(data.parts.length === q.blanks.length &&
    data.parts.every((p) =>
      q.blanks.some((b) => b.id === p.id),
    ), "空位解答没有完整对应");
  for (const p of data.parts) {
    require(str(p.answer), "空位缺少答案");
    validateBasis(p);
  }
  const pool = q.options.length ? q.options : input.group.options;
  require(list(data.answerIds) &&
    new Set(data.answerIds).size === data.answerIds.length &&
    data.answerIds.every((id) =>
      pool.some((o) => o.id === id),
    ), "参考选项答案不属于本题");
  if (
    !q.blanks.length &&
    ["single", "multiple"].includes(q.response) &&
    !data.uncertain
  )
    require(q.response === "single"
      ? data.answerIds.length === 1
      : data.answerIds.length > 0, "参考选择答案数量与作答方式不符");
  for (const part of data.parts) {
    if (pool.length && !data.uncertain)
      require(pool.some(
        (o) => o.id === part.optionId,
      ), "空位答案未对应所属选项或共享词库");
    if (part.optionId != null)
      require(pool.some((o) => o.id === part.optionId), "空位答案引用外部选项");
  }
  unique(data.options, "选项解释");
  require(data.options.length === pool.length &&
    data.options.every((p) =>
      pool.some((o) => o.id === p.id),
    ), "选项解释没有完整对应");
  for (const o of data.options) {
    require(Object.hasOwn(relations, o.relation), "选项与原文关系无效");
    validateBasis(o);
    if (["supported", "contradicted"].includes(o.relation))
      require(o.citations.length, "支持或矛盾需有真实依据");
  }
  // Keep colors and explanation order aligned with the printed option pool.
  data.options.sort(
    (a, b) =>
      pool.findIndex((o) => o.id === a.id) -
      pool.findIndex((o) => o.id === b.id),
  );
  if (q.kind === "translation") {
    const t = data.translation;
    require(t &&
      ["exact", "adapted", "none", "not_required"].includes(t.mode) &&
      str(t.expression) &&
      str(t.adjustments) &&
      list(t.alternatives) &&
      t.alternatives.every(str) &&
      list(t.citations), "翻译需区分参考译法、原文表达、调整及其他表达");
    t.citations = t.citations.map((r) =>
      locate(
        r,
        input.paragraphs.filter((p) => p.kind === "body"),
      ),
    );
    if (["exact", "adapted"].includes(t.mode))
      require(t.expression &&
        t.citations.some((c) =>
          c.quote.includes(t.expression),
        ), "原文对应表达未在正文引用中找到");
    if (t.mode === "exact")
      require(data.answer === t.expression, "调整后的译文不能标为原文表达");
    if (t.mode === "adapted")
      require(t.adjustments.trim(), "调整表达必须说明调整");
    if (t.mode === "none" || t.mode === "not_required")
      require(!t.citations.length && !t.expression, "无对应表达时不能伪造来源");
  }
  return data;
}
export function saveAttempt(project, group, item, value) {
  project.worksheetAnswers ??= [];
  let row = project.worksheetAnswers.find(
    (r) => r.itemId === item.id && r.versionId === group.versionId,
  );
  if (!row) {
    row = {
      id: uid(),
      groupId: group.id,
      itemId: item.id,
      versionId: group.versionId,
      value: {},
      status: "working",
    };
    project.worksheetAnswers.push(row);
  }
  row.value = value;
  row.updated = new Date().toISOString();
  return row;
}
export function attempt(project, group, item) {
  return project.worksheetAnswers?.find(
    (r) => r.itemId === item.id && r.versionId === group.versionId,
  );
}

export const recognitionSchema = `Return {groups:[{id,title,articleId,instructions,raw,sources:[REF],options:[{id,label,text}],reuse:"yes|no|unknown",inflect:"yes|no|unknown",items:[{id,number,kind:"reading|cloze|word_bank|grammar|completion|short_answer|translation|judgment|matching|unknown",response:"single|multiple|blanks|text|matching",stem,requirements,options:[{id,label,text}],blanks:[{id,label,hint,location:REF or null}],translation:{direction:"en_zh|zh_en|unknown",unit:"word|phrase|sentence|unknown",useSource:"yes|no|unknown"} or null,sources:[REF],uncertainties:[string]}]}]}. REF={articleId,paragraphId,versionId,quote,start(optional exact UTF-16 offset)}. Use exact supplied IDs in references, unique ASCII IDs for groups/items/options/blanks. All string fields and arrays required. number empty if missing. Keep all source wording including unknown tasks; never invent options or blanks. Cover ALL supplied question and exercise blocks; distinguish shared instructions/bank from local options. Grammar blanks may have empty hint. Cloze may have separate items with one blank each and local choices. Multi-select ONLY when explicitly stated. Unknown type uses unknown plus suitable response, never pretends deep support. Suggest contextual associations only if exact quotation exists; repeated text requires correct start. Recognition NEVER answers or explains or evaluates. Preserve original instructions; do not insert answers in stems. sources identify original exercise text, item.sources may additionally suggest context. Missing information goes in uncertainties.`;
export const helpSchema = `Return {itemId,hint,answer,answerIds:[option ID],explanation,uncertain:boolean,parts:[{id,answer,optionId:option ID or null,basis,text,citations:[REF]}],options:[{id,relation:"supported|contradicted|unmentioned|inference|insufficient",basis,text,citations:[REF]}],points:[{basis,text,citations:[REF]}],translation:{mode:"exact|adapted|none|not_required",expression,adjustments,alternatives:[string],citations:[REF]} or null}. REF={articleId,paragraphId,versionId,quote,start(optional UTF-16 offset)}. basis="evidence|rule|inference|translation". answerIds must contain only IDs from the local or shared pool, exactly one for a single selection and one or more for multiple selection (empty for text or uncertain answers). Each blank with an option pool must provide optionId from that pool, even when word forms change. All prose in Chinese except answers/quoted English. parts covers EVERY blank once; options covers EVERY local option, otherwise every shared option, once. No missing/extra IDs. For cloze/grammar/bank/completion explain each blank and its rule, collocation or context. Short answers provide individual answer points and their own evidence. For each reading option distinguish direct support, contradiction, absence, inference or insufficient information; explain specific altered subject/time/scope/degree/cause, not generic mismatch. Never manufacture citations for absent evidence; inference may need multiple quotations and explicit reasoning. Quotes must exist verbatim in the correct supplied material/version. Use exact phrase offsets only when known; repeated quotes require precise offset. Reference existence does not prove semantic correctness. If missing options/material say uncertain and explain. Translation must match direction and word/phrase/sentence unit and current context, avoid dictionary concatenation and full syntax analysis. For zh_en useSource=yes or material-bound prompts, search ONLY supplied article body for corresponding expressions, including paraphrased Chinese prompts. Distinguish answer, original expression, tense/person/form adjustments and acceptable alternatives. exact means answer is verbatim original expression with a body citation; adapted must explain adjustments and never call answer an original sentence; none means no confirmed expression (say so, give ordinary reference translation); not_required when no source constraint and no confirmed expression. For en_zh give fluent contextual translation, original English in expression with mode adapted and adjustments describing translation rather than falsely claiming the Chinese occurs in the source. Hints must not reveal the answer. Multiple reasonable answers are allowed. No authoritative scoring.`;
