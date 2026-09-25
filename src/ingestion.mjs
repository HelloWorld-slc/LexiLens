import { decodeJson, parseOutput, paragraph, uid } from "./core.mjs";

const names = {
  question: "题目区",
  introduction: "介绍区",
  vocabulary: "生词积累区",
  caption: "标题与标注",
  table: "表格区",
  other: "其它内容",
};
// Only normalize metadata. Printed text is never rewritten or silently discarded.
export function normalizeOcr(raw) {
  let d = typeof raw === "string" ? decodeJson(raw) : structuredClone(raw);
  d = d?.result ?? d?.data ?? d;
  if (!d || typeof d !== "object") throw Error("缺少转写内容");
  const articles = Array.isArray(d.articles) ? d.articles : [];
  const blocks =
    d.paragraphs ??
    d.blocks ??
    articles.flatMap((a, i) =>
      (a.paragraphs ?? a.blocks ?? []).map((p) => ({
        ...(typeof p === "string" ? { text: p } : p),
        article: a.id ?? String(i + 1),
      })),
    );
  if (!Array.isArray(blocks) || !blocks.length) throw Error("转写没有可用段落");
  const seen = new Set();
  const nonempty = blocks.filter((value) => {
    const text =
      typeof value === "string" ? value : (value?.text ?? value?.content);
    return typeof text !== "string" || !!text.trim();
  });
  if (!nonempty.length) throw Error("转写没有可用段落");
  const paragraphs = nonempty.map((value, i) => {
    const p = typeof value === "string" ? { text: value } : value;
    if (
      !p ||
      typeof (p.text ?? p.content) !== "string" ||
      !(p.text ?? p.content).trim()
    )
      throw Error("存在空白或无法读取的转写块，请重试本页");
    const id = String(p.id ?? `p${i + 1}`);
    if (seen.has(id)) throw Error("转写块编号重复，需重新整理");
    seen.add(id);
    const owner =
      articles.find(
        (a) =>
          (a.body_ids ?? []).map(String).includes(id) ||
          (a.sections ?? []).some((s) =>
            (s.block_ids ?? []).map(String).includes(id),
          ),
      ) ?? (articles.length === 1 ? articles[0] : null);
    const article = String(
      p.article ?? p.article_id ?? owner?.id ?? (articles.length ? "" : "A"),
    );
    if (!article) throw Error("部分文字的文章归属不明确");
    const rawKind =
      p.kind ??
      p.type ??
      ((owner?.body_ids ?? []).map(String).includes(id) ? "body" : undefined);
    const kind =
      {
        paragraph: "body",
        正文: "body",
        questions: "question",
        题目: "question",
      }[rawKind] ?? rawKind;
    const validKind = kind === "body" || kind in names;
    return {
      ...p,
      id,
      article,
      text: p.text ?? p.content,
      kind: validKind ? kind : "other",
      uncertain:
        p.uncertain === false || p.uncertain === "false" ? !validKind : true,
    };
  });
  const normalized = [...new Set(paragraphs.map((p) => p.article))].map(
    (id) => {
      const a = articles.find((a) => String(a.id) === id) ?? {};
      const ps = paragraphs.filter((p) => p.article === id);
      const sections = new Map();
      for (const p of ps.filter((p) => p.kind !== "body")) {
        const old = (a.sections ?? []).find((s) =>
          (s.block_ids ?? []).map(String).includes(p.id),
        );
        const name = String(old?.name || p.section_name || names[p.kind]);
        sections.set(name, [...(sections.get(name) ?? []), p.id]);
      }
      const title =
        typeof a.title === "string" &&
        a.title.trim() &&
        !/^[A-F](?:[（(]选做[）)])?$/.test(a.title.trim())
          ? a.title
          : `文章 ${id}（标题待补充）`;
      return {
        ...a,
        id,
        title,
        title_inferred: a.title_inferred !== false,
        boundary: { start_id: ps[0].id, end_id: ps.at(-1).id },
        body_ids: ps.filter((p) => p.kind === "body").map((p) => p.id),
        sections: [...sections].map(([name, block_ids]) => ({
          name,
          block_ids,
        })),
      };
    },
  );
  return parseOutput(
    "ocr",
    JSON.stringify({
      ...d,
      article_count: normalized.length,
      articles: normalized,
      paragraphs,
      notes: [
        ...(Array.isArray(d.notes) ? d.notes : d.notes ? [d.notes] : []),
        ...(nonempty.length < blocks.length
          ? ["已忽略无文字的空占位块，原始返回保留供核对。"]
          : []),
      ],
      punctuation_suggestions: Array.isArray(d.punctuation_suggestions)
        ? d.punctuation_suggestions
        : [],
    }),
  );
}

export function previousPageContext(project, page) {
  const i = project.pages.indexOf(page),
    previous = project.pages[i - 1];
  if (!previous?.ocr?.parsed || previous.ocr.assetId !== previous.current.id)
    return null;
  return {
    pageId: previous.id,
    assetId: previous.current.id,
    articles: previous.ocr.parsed.articles.map((a) => ({
      id: a.id,
      title: a.title,
      tail: previous.ocr.parsed.paragraphs
        .filter((p) => p.article === a.id && p.kind === "body")
        .slice(-3)
        .map((p) => p.text),
    })),
  };
}

export function validateContinuations(parsed, previous) {
  for (const a of parsed.articles) {
    if (!a.continuation_of) continue;
    const c = a.continuation_of;
    if (
      !previous ||
      c.pageId !== previous.pageId ||
      !previous.articles.some((p) => p.id === c.articleId) ||
      typeof c.reason !== "string" ||
      !c.reason.trim()
    )
      throw Error("跨页续文指向不明确，请重新核对");
  }
}

export function applyOcrPage(project, page) {
  const ocr = page.ocr;
  if (!ocr?.parsed || ocr.assetId !== page.current.id)
    throw Error("图片已变化或识别未完成，请先重新识别");
  if (ocr.applied) return [];
  const previous = previousPageContext(project, page);
  if (
    ocr.previous &&
    (previous?.pageId !== ocr.previous.pageId ||
      previous?.assetId !== ocr.previous.assetId)
  )
    throw Error("前一页顺序或图片已变化，请重新识别本页");
  validateContinuations(ocr.parsed, previous);
  // Preflight all targets before changing the project, so a rejected page is atomic.
  const targets = ocr.parsed.articles.map((meta) => {
    if (!meta.continuation_of) return null;
    const prev = project.pages.find(
      (p) => p.id === meta.continuation_of.pageId,
    );
    const id = prev?.ocr?.articleMap?.[meta.continuation_of.articleId];
    const target = project.articles.find((a) => a.id === id);
    if (!prev?.ocr?.applied || !target)
      throw Error("请先核对并应用前一页，再接入本页续文");
    return target;
  });
  const result = [],
    map = {};
  ocr.parsed.articles.forEach((meta, i) => {
    const target = targets[i] ?? {
      id: uid(),
      title: meta.title,
      detection: { ...meta, pageId: page.id },
      paragraphs: [],
      notes: [],
      questionsVerified: false,
    };
    if (!targets[i]) project.articles.push(target);
    target.paragraphs.push(
      ...ocr.parsed.paragraphs
        .filter((p) => p.article === meta.id)
        .map((p) => ({
          ...paragraph(p.text, p.kind, page.id),
          uncertain: p.uncertain,
          sectionName: meta.sections.find((s) => s.block_ids.includes(p.id))
            ?.name,
        })),
    );
    target.notes.push(...ocr.parsed.notes);
    map[meta.id] = target.id;
    result.push(target.id);
  });
  ocr.articleMap = map;
  ocr.applied = true;
  ocr.status = "已应用";
  return result;
}
