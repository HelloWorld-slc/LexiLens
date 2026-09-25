// Shared domain logic. Text is never normalized; ranges use UTF-16 [start,end).
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function newLibrary() {
  return {
    schema: 1,
    id: uid(),
    projects: [],
    favorites: [],
    results: [],
    tasks: [],
    settings: {
      theme: "dark",
      mode: "auto",
      delay: 650,
      fontSize: 20,
      lineHeight: 1.9,
      width: 760,
      showNumbers: true,
      model: "deepseek-flash",
      uploadConsent: false,
    },
    lastProject: null,
  };
}
export function newProject(title) {
  return {
    id: uid(),
    title: title.trim() || "未命名材料",
    created: now(),
    updated: now(),
    archived: false,
    deletedAt: null,
    deleteFavorites: false,
    pages: [],
    articles: [],
    lastArticle: null,
    scroll: 0,
    lastSelection: null,
  };
}
export function paragraph(text, kind = "body", pageId = null) {
  const v = { id: uid(), text, origin: "ocr", created: now() };
  return {
    id: uid(),
    kind,
    pageId,
    versions: [v],
    currentVersion: v.id,
    uncertain: false,
  };
}
export const currentText = (p) =>
  p.versions.find((v) => v.id === p.currentVersion)?.text ?? "";
export function editParagraph(p, text, expectedVersion) {
  if (p.currentVersion !== expectedVersion)
    throw Error("正文已变化，请重新核对差异");
  const v = { id: uid(), text, origin: "user", created: now() };
  p.versions.push(v);
  p.currentVersion = v.id;
}
export function splitParagraph(p, offset, expectedVersion) {
  const text = currentText(p);
  if (!Number.isInteger(offset) || offset <= 0 || offset >= text.length)
    throw Error("拆分点必须在段落内部");
  editParagraph(p, text.slice(0, offset), expectedVersion);
  const next = paragraph(text.slice(offset), p.kind, p.pageId);
  next.versions[0].origin = "user";
  next.derivedFrom = {
    paragraphId: p.id,
    versionId: expectedVersion,
    start: offset,
    end: text.length,
  };
  return next;
}
export function expandWords(text, anchor, focus) {
  if (!Number.isInteger(anchor) || !Number.isInteger(focus)) return null;
  const a = Math.max(0, Math.min(anchor, focus)),
    b = Math.min(text.length, Math.max(anchor, focus));
  const hits = [...text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)].filter(
    (m) =>
      a === b
        ? a >= m.index && a < m.index + m[0].length
        : m.index < b && m.index + m[0].length > a,
  );
  if (!hits.length) return null;
  const start = hits[0].index,
    end = hits.at(-1).index + hits.at(-1)[0].length;
  return { start, end, quote: text.slice(start, end) };
}
export function sentenceRange(text, start, end = start + 1) {
  const parts = [
    ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text),
  ];
  const hits = parts.filter(
    (s) => s.index < end && s.index + s.segment.length > start,
  );
  if (!hits.length) return { start: 0, end: text.length, quote: text };
  const a = hits[0].index,
    b = hits.at(-1).index + hits.at(-1).segment.length;
  return { start: a, end: b, quote: text.slice(a, b) };
}
export function anchorFor(project, article, p, start, end) {
  const text = currentText(p),
    sentence = sentenceRange(text, start, end);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length
  )
    throw Error("无效选区");
  return {
    projectId: project.id,
    articleId: article.id,
    paragraphId: p.id,
    versionId: p.currentVersion,
    start,
    end,
    quote: text.slice(start, end),
    sentence,
    projectTitle: project.title,
    articleTitle: article.title,
  };
}
export function resolveAnchor(library, a) {
  if (!a?.sentence) return { status: "stale" };
  const project = library.projects.find(
    (p) => p.id === a.projectId && !p.deletedAt,
  );
  const article = project?.articles.find((p) => p.id === a.articleId),
    p = article?.paragraphs.find((p) => p.id === a.paragraphId);
  const text = p ? currentText(p) : "";
  const valid =
    !!p &&
    p.currentVersion === a.versionId &&
    Number.isInteger(a.start) &&
    Number.isInteger(a.end) &&
    a.start >= 0 &&
    a.end > a.start &&
    a.end <= text.length &&
    text.slice(a.start, a.end) === a.quote &&
    text.slice(a.sentence.start, a.sentence.end) === a.sentence.quote;
  return { status: valid ? "valid" : "stale", project, article, paragraph: p };
}
export function cacheKey(task, anchor, model, context, extra = "") {
  return JSON.stringify([2, task, anchor, model, context, extra]);
}
export function saveFavorite(
  lib,
  anchor,
  meaning,
  lemma = anchor.quote.toLowerCase(),
) {
  const key = JSON.stringify([
    anchor.projectId,
    anchor.paragraphId,
    anchor.versionId,
    anchor.start,
    anchor.end,
  ]);
  let f = lib.favorites.find((f) => f.key === key);
  if (f) return f;
  f = {
    id: uid(),
    key,
    anchor: structuredClone(anchor),
    original: anchor.quote,
    lemma,
    meaning,
    created: now(),
    rating: "unknown",
    reviews: [],
    sourceDeleted: false,
  };
  lib.favorites.push(f);
  return f;
}
export function reviewBatch(favorites, size = 10) {
  const rank = { unknown: 0, fuzzy: 1, known: 2 };
  return [...favorites]
    .sort(
      (a, b) =>
        rank[a.rating] - rank[b.rating] || b.created.localeCompare(a.created),
    )
    .slice(0, size)
    .map((f) => f.id);
}
export function purgeProject(lib, id) {
  const p = lib.projects.find((p) => p.id === id);
  if (!p) return;
  lib.projects = lib.projects.filter((p) => p.id !== id);
  lib.favorites = lib.favorites.filter(
    (f) => f.anchor.projectId !== id || !p.deleteFavorites,
  );
  lib.favorites
    .filter((f) => f.anchor.projectId === id)
    .forEach((f) => (f.sourceDeleted = true));
  lib.results = lib.results.filter(
    (r) => r.anchor?.projectId !== id && r.projectId !== id,
  );
  lib.tasks = lib.tasks.filter((t) => t.projectId !== id);
  if (lib.lastProject === id) lib.lastProject = null;
}
export function expireTrash(lib, clock = Date.now()) {
  lib.projects
    .filter(
      (p) => p.deletedAt && clock - Date.parse(p.deletedAt) >= 7 * 86400000,
    )
    .forEach((p) => purgeProject(lib, p.id));
}
export function parseOutput(task, raw, anchor) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Error("格式解析失败，原稿已保留，可重试");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("结果必须为JSON对象");
  if (task === "ocr") {
    if (!Array.isArray(data.paragraphs) || !data.paragraphs.length)
      throw Error("转写没有段落");
    const ids = new Set();
    for (const p of data.paragraphs) {
      if (
        !p ||
        typeof p.id !== "string" ||
        ids.has(p.id) ||
        typeof p.text !== "string" ||
        !p.text.trim() ||
        !["body", "question", "table", "caption"].includes(p.kind) ||
        typeof p.uncertain !== "boolean"
      )
        throw Error("转写字段不完整，需核对原稿");
      ids.add(p.id);
    }
    if (
      !Array.isArray(data.notes) ||
      !Array.isArray(data.punctuation_suggestions)
    )
      throw Error("转写缺核对字段");
  } else if (task === "summary") {
    if (
      typeof data.summary !== "string" ||
      !data.summary.trim() ||
      !Array.isArray(data.points) ||
      !data.points.length
    )
      throw Error("总结为空或缺引用");
    for (const point of data.points) {
      if (
        typeof point.text !== "string" ||
        typeof point.inference !== "boolean" ||
        !Array.isArray(point.citations) ||
        !point.citations.length
      )
        throw Error("总结要点缺原句引用");
    }
  } else {
    if (
      data.selection !== anchor?.quote ||
      data.sentence !== anchor?.sentence.quote ||
      typeof data.meaning_zh !== "string" ||
      !data.meaning_zh.trim()
    )
      throw Error("结果与选区或原句不一致");
  }
  return data;
}
export function validateCitations(points, paragraphs) {
  for (const point of points)
    for (const c of point.citations) {
      const p = paragraphs.find(
        (p) => p.paragraphId === c.paragraphId && p.versionId === c.versionId,
      );
      if (!p || typeof c.quote !== "string" || !c.quote.trim())
        throw Error("引用不存在或版本不匹配");
      const matches = [
        ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(
          p.text,
        ),
      ].filter((s) => s.segment.trim() === c.quote.trim());
      if (matches.length !== 1) throw Error("引用必须是可唯一定位的完整原句");
      c.start = matches[0].index;
      c.end = c.start + matches[0].segment.length;
      c.quote = matches[0].segment;
    }
}
export class RequestScope {
  constructor() {
    this.generation = 0;
    this.requests = new Map();
  }
  begin(id, cancel) {
    const generation = this.generation;
    this.requests.set(id, cancel);
    return () => generation === this.generation;
  }
  finish(id) {
    this.requests.delete(id);
  }
  cancel() {
    this.generation++;
    for (const stop of this.requests.values()) stop();
    this.requests.clear();
  }
}
export class SelectionController {
  constructor({
    request,
    render,
    delay = 650,
    mode = "auto",
    schedule = (f, t) => setTimeout(f, t),
    unschedule = (t) => clearTimeout(t),
  }) {
    this.request = request;
    this.render = render;
    this.delay = delay;
    this.mode = mode;
    this.schedule = schedule;
    this.unschedule = unschedule;
    this.generation = 0;
  }
  cancel() {
    this.generation++;
    if (this.timer !== undefined) this.unschedule(this.timer);
    this.timer = undefined;
    this.abort?.abort();
    this.abort = undefined;
    this.selection = undefined;
  }
  choose(a) {
    this.cancel();
    this.selection = structuredClone(a);
    if (this.mode === "auto")
      this.timer = this.schedule(() => this.confirm(), this.delay);
  }
  async confirm() {
    if (!this.selection || this.abort) return;
    if (this.timer !== undefined) this.unschedule(this.timer);
    this.timer = undefined;
    const g = this.generation,
      a = structuredClone(this.selection),
      abort = new AbortController();
    this.abort = abort;
    try {
      const result = await this.request(a, abort.signal);
      if (g === this.generation && !abort.signal.aborted)
        this.render({ selection: a, result });
    } catch (error) {
      if (g === this.generation && !abort.signal.aborted)
        this.render({ selection: a, error: String(error.message ?? error) });
    } finally {
      if (g === this.generation) this.abort = undefined;
    }
  }
}
export function importAsCopy(target, source) {
  if (
    source?.schema !== 1 ||
    !Array.isArray(source.projects) ||
    !Array.isArray(source.favorites)
  )
    throw Error("不支持的备份格式");
  const copy = structuredClone(source),
    map = new Map();
  function collect(o) {
    if (!o || typeof o !== "object") return;
    if (typeof o.id === "string" && !(o.mime && o.hash)) map.set(o.id, uid());
    Object.values(o).forEach((v) => {
      if (v && typeof v === "object")
        Array.isArray(v) ? v.forEach(collect) : collect(v);
    });
  }
  collect(copy);
  function remap(o) {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (
        typeof o[k] === "string" &&
        map.has(o[k]) &&
        (k === "id" ||
          /Id$/.test(k) ||
          ["currentVersion", "lastProject", "lastArticle"].includes(k))
      )
        o[k] = map.get(o[k]);
      else if (o[k] && typeof o[k] === "object")
        Array.isArray(o[k]) ? o[k].forEach(remap) : remap(o[k]);
    }
  }
  remap(copy);
  copy.favorites.forEach(
    (f) =>
      (f.key = JSON.stringify([
        f.anchor.projectId,
        f.anchor.paragraphId,
        f.anchor.versionId,
        f.anchor.start,
        f.anchor.end,
      ])),
  );
  target.projects.push(...copy.projects);
  target.favorites.push(...copy.favorites);
  target.results.push(...(copy.results ?? []));
  target.tasks.push(...(copy.tasks ?? []));
  return target;
}
