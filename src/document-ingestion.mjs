import {
  decodeJson,
  paragraph,
  currentText,
  uid,
  now,
  validateCitations,
} from "./core.mjs";

const fold = (text) => text.replace(/\s+/g, " ").trim();
export function normalizeTranscript(raw, pages) {
  const d = typeof raw === "string" ? decodeJson(raw) : structuredClone(raw);
  if (!Array.isArray(d.pages) || d.pages.length !== pages.length)
    throw Error("整组转写页数不完整");
  const blocks = [];
  pages.forEach((page, index) => {
    const source = d.pages[index];
    if (
      source.pageId !== page.id ||
      !Array.isArray(source.blocks) ||
      !source.blocks.length
    )
      throw Error(`第${index + 1}页缺少转写内容或顺序错误`);
    for (const b of source.blocks) {
      if (typeof b.text !== "string") throw Error("转写文字格式不正确");
      if (!b.text.trim()) continue;
      blocks.push({
        ...b,
        id: `b${blocks.length + 1}`,
        pageId: page.id,
        pageOrder: index,
        uncertain: b.uncertain !== false,
      });
    }
  });
  if (!blocks.length) throw Error("未识别到文字");
  return { blocks, notes: Array.isArray(d.notes) ? d.notes : [] };
}

function expandSplits(blocks, splits = []) {
  const expanded = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set();
  for (const s of splits) {
    const source = expanded.get(s.block_id);
    if (
      !source ||
      seen.has(s.block_id) ||
      !Array.isArray(s.parts) ||
      s.parts.length < 2
    )
      throw Error("自然段拆分引用错误");
    seen.add(s.block_id);
    let cursor = 0;
    const parts = s.parts.map((text, i) => {
      if (typeof text !== "string" || !text.trim())
        throw Error("自然段拆分为空");
      const at = source.text.indexOf(text.trim(), cursor);
      if (at < 0 || source.text.slice(cursor, at).trim())
        throw Error("拆分改动或遗漏了原文");
      const end = at + text.trim().length,
        piece = {
          ...source,
          id: `${source.id}#${i + 1}`,
          text: source.text.slice(cursor, end),
        };
      cursor = end;
      return piece;
    });
    if (source.text.slice(cursor).trim()) throw Error("拆分遗漏段末原文");
    parts.at(-1).text += source.text.slice(cursor);
    expanded.delete(source.id);
    for (const part of parts) {
      if (expanded.has(part.id)) throw Error("拆分编号重复");
      expanded.set(part.id, part);
    }
  }
  return expanded;
}

export function organizeTranscript(raw, transcript) {
  const d = typeof raw === "string" ? decodeJson(raw) : structuredClone(raw);
  if (
    !d.checks?.cross_page_reviewed ||
    !d.checks?.paragraphs_reviewed ||
    !d.checks?.questions_reviewed
  )
    throw Error("缺少全文复核，请重新检查跨页续文、自然段与题目");
  if (!Array.isArray(d.articles) || !Array.isArray(d.extras))
    throw Error("整理缺少文章或非文章分区");
  const blocks = expandSplits(transcript.blocks, d.splits),
    claimed = new Set(),
    titles = new Set(),
    extras = [];
  const take = (ids, kind, name = "") => {
    if (!Array.isArray(ids) || !ids.length) throw Error("整理内容缺原文编号");
    const parts = ids.map((id) => {
      const b = blocks.get(id);
      if (!b || claimed.has(id))
        throw Error(`内容被重复归属或编号不存在：${id}`);
      claimed.add(id);
      return b;
    });
    return {
      text: parts
        .map((b) => b.text.trim())
        .join(kind === "question" ? "\n" : " "),
      kind,
      sectionName: name,
      pageId: parts[0].pageId,
      pageIds: [...new Set(parts.map((b) => b.pageId))],
      blockIds: ids,
      uncertain: parts.some((b) => b.uncertain),
    };
  };
  const duplicateMap = new Map();
  for (const dupe of d.duplicates ?? []) {
    const b = blocks.get(dupe.block_id),
      original = blocks.get(dupe.same_as);
    if (
      !b ||
      !original ||
      b.id === original.id ||
      claimed.has(b.id) ||
      fold(b.text) !== fold(original.text) ||
      fold(b.text).length < 60
    )
      throw Error("重复内容缺乏一致的原文依据");
    claimed.add(b.id);
    duplicateMap.set(b.id, original.id);
  }
  for (const s of d.extras)
    extras.push(take(s.block_ids, "other", s.name || "其它资料"));
  const articles = [];
  for (const a of d.articles) {
    if (!Array.isArray(a.body) || !Array.isArray(a.questions))
      throw Error("文章缺少正文或题目归属");
    const body = a.body.map((ids) => take(ids, "body"));
    const questions = a.questions.map((ids) => take(ids, "question", "选择题"));
    const sections = (a.sections ?? []).map((s) =>
      take(s.block_ids, "other", s.name || "其它资料"),
    );
    const text = body.map((p) => p.text).join("\n");
    // Labels, instructions and options remain recoverable outside the article list.
    if (
      (text.match(/[A-Za-z]+/g) ?? []).length < 20 ||
      /^[A-Z](?:\s*[(（].*[)）])?\s*$/.test(text.trim())
    ) {
      extras.push(
        ...[...body, ...questions, ...sections].map((p) => ({
          ...p,
          kind: "other",
          sectionName: "待归属内容",
        })),
      );
      continue;
    }
    if (
      typeof a.title !== "string" ||
      !/[\u3400-\u9fff]/u.test(a.title) ||
      a.title.length > 40 ||
      /待补充|^文章\s*[A-Z]|^[#\d\s.、]+/.test(a.title)
    )
      throw Error(
        "请为每篇真实文章提供统一、简洁的中文内容标题，不使用字母、编号或占位标题",
      );
    if (titles.has(a.title.trim()))
      throw Error("文章标题重复，请检查是否为同一篇跨页文章");
    titles.add(a.title.trim());
    for (const p of body) {
      if (/^(?:\d+[.、)]\s*|[A-D][.、)]\s*)/.test(p.text))
        throw Error("选择题或选项进入正文，请重新检查分区");
      if (/\n\s*\n/.test(p.text) || p.text.length > 1800)
        throw Error("正文疑似多个自然段合在一块，请重新拆分");
      if (p.text.match(/\\n|\\"/))
        throw Error("正文包含未解码的排版转义，请回到原图核对转写");
    }
    articles.push({
      title: a.title.trim(),
      sourceLabel: a.source_label || "",
      paragraphs: [...body, ...questions, ...sections],
    });
  }
  for (const [dupe, original] of duplicateMap)
    if (!claimed.has(original) || duplicateMap.has(original))
      throw Error("重复块必须指向已保留的唯一原文");
  if (claimed.size !== blocks.size)
    throw Error(
      `仍有${blocks.size - claimed.size}个原文块未分配，请保留到正文、题目或其它资料，不可丢弃`,
    );
  for (const a of articles) {
    const body = a.paragraphs.filter((p) => p.kind === "body");
    for (let i = 1; i < body.length; i++)
      if (
        !/[.!?。！？][\"”’']?$/.test(body[i - 1].text.trim()) &&
        /^[a-z]/.test(body[i].text.trim())
      )
        throw Error("同一自然段的续文尚未接合，请合并未完句片段");
  }
  const bodySeen = new Set();
  for (const a of articles)
    for (const p of a.paragraphs.filter((p) => p.kind === "body")) {
      const key = fold(p.text);
      if (key.length > 80 && bodySeen.has(key))
        throw Error("发现重复正文段落，请检查重复拍摄内容");
      bodySeen.add(key);
    }
  // A lowercase fragment after an unfinished page ending is a strong missed-continuation signal.
  for (let i = 1; i < articles.length; i++) {
    const previous = articles[i - 1].paragraphs
        .filter((p) => p.kind === "body")
        .at(-1),
      first = articles[i].paragraphs.find((p) => p.kind === "body");
    if (
      previous &&
      first &&
      !/[.!?。！？]["”’']?$/.test(previous.text.trim()) &&
      /^[a-z]/.test(first.text.trim())
    )
      throw Error("相邻文章存在明显未完句续文，请合并后再次整理");
  }
  return {
    articles,
    extras,
    notes: transcript.notes,
    duplicates: [...duplicateMap].map(([blockId, sameAs]) => ({
      blockId,
      sameAs,
    })),
    checks: d.checks ?? {},
  };
}

export function pageSnapshot(project) {
  return JSON.stringify(project.pages.map((p) => [p.id, p.current.id]));
}

export function applyDocument(project, batch) {
  if (batch.applied) return;
  if (!batch.data || batch.snapshot !== pageSnapshot(project))
    throw Error("图片或页序已经变化，请重新联合识别");
  const old = project.articles,
    usedParagraphs = new Set(),
    usedArticles = new Set();
  const make = (block) => {
    const existing = old
      .flatMap((a) => a.paragraphs)
      .find(
        (p) =>
          !usedParagraphs.has(p.id) &&
          p.kind === block.kind &&
          currentText(p) === block.text,
      );
    if (existing) usedParagraphs.add(existing.id);
    return {
      ...(existing
        ? structuredClone(existing)
        : paragraph(block.text, block.kind, block.pageId)),
      pageId: block.pageId,
      pageIds: block.pageIds,
      sectionName: block.sectionName,
      uncertain: block.uncertain,
    };
  };
  const articles = batch.data.articles.map((meta) => {
    const paragraphs = meta.paragraphs.map(make);
    const candidates = old
      .filter((a) => !usedArticles.has(a.id))
      .map((a) => ({
        a,
        score: a.paragraphs.filter((p) => paragraphs.some((x) => x.id === p.id))
          .length,
      }))
      .sort((a, b) => b.score - a.score);
    const id = candidates[0]?.score ? candidates[0].a.id : uid();
    usedArticles.add(id);
    return {
      id,
      title: meta.title,
      sourceLabel: meta.sourceLabel,
      paragraphs,
      notes: batch.data.notes,
      questionsVerified: false,
    };
  });
  project.organizationHistory ??= [];
  if (old.length || project.sections?.length)
    project.organizationHistory.push({
      id: uid(),
      created: now(),
      articles: structuredClone(old),
      sections: structuredClone(project.sections ?? []),
    });
  project.articles = articles;
  project.sections = batch.data.extras.map(make);
  project.lastArticle = articles[0]?.id ?? null;
  project.pages.forEach(
    (p) =>
      (p.ocr = {
        ...p.ocr,
        status: "整组已整理",
        applied: true,
        documentBatchId: batch.id,
        assetId: p.current.id,
      }),
  );
  batch.applied = true;
}

export function rebindAnchors(library, project) {
  const owners = new Map(
    project.articles.flatMap((a) => a.paragraphs.map((p) => [p.id, a])),
  );
  const anchors = [
    ...library.favorites.map((f) => f.anchor),
    ...library.results.map((r) => r.anchor),
    project.lastSelection,
  ];
  for (const a of anchors)
    if (a?.projectId === project.id && owners.has(a.paragraphId)) {
      a.articleId = owners.get(a.paragraphId).id;
      a.articleTitle = owners.get(a.paragraphId).title;
    }
}

export function restoreOrganization(project, historyId) {
  const index = (project.organizationHistory ?? []).findIndex(
    (h) => h.id === historyId,
  );
  if (index < 0) throw Error("历史整理不存在");
  const target = project.organizationHistory.splice(index, 1)[0];
  project.organizationHistory.push({
    id: uid(),
    created: now(),
    articles: structuredClone(project.articles),
    sections: structuredClone(project.sections ?? []),
  });
  project.articles = target.articles;
  project.sections = target.sections;
  project.lastArticle = project.articles[0]?.id ?? null;
  // The previous result must not remain marked as the currently applied organization.
  if (project.documentBatch) project.documentBatch.applied = false;
}
export function validateAnswers(raw, body, questions) {
  const d = typeof raw === "string" ? decodeJson(raw) : structuredClone(raw);
  if (!Array.isArray(d.answers) || d.answers.length !== questions.length)
    throw Error("解答未完整覆盖所有题目");
  d.answers.forEach((a, i) => {
    if (
      a.questionId !== questions[i].paragraphId ||
      typeof a.answer !== "string" ||
      !a.answer.trim() ||
      typeof a.explanation !== "string" ||
      !a.explanation.trim() ||
      typeof a.uncertain !== "boolean" ||
      !Array.isArray(a.citations)
    )
      throw Error("解答题目归属或格式不正确");
    if (!a.uncertain && !a.citations.length)
      throw Error("确定的答案缺原文依据");
    validateCitations([a], body);
  });
  return d;
}
