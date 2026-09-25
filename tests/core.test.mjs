import test from "node:test";
import assert from "node:assert/strict";
import {
  newLibrary,
  newProject,
  paragraph,
  anchorFor,
  resolveAnchor,
  editParagraph,
  expandWords,
  saveFavorite,
  reviewBatch,
  purgeProject,
  expireTrash,
  SelectionController,
  parseOutput,
  importAsCopy,
  cacheKey,
  validateCitations,
  RequestScope,
  splitParagraph,
} from "../src/core.mjs";
test("paragraph split preserves every source character and immutable old version", () => {
  const p = paragraph("First sentence. Second sentence.");
  const old = p.currentVersion,
    text = p.versions[0].text;
  const next = splitParagraph(p, 16, old);
  assert.equal(p.versions[0].text, text);
  assert.equal(p.versions[1].text + next.versions[0].text, text);
  assert.equal(next.derivedFrom.versionId, old);
  assert.throws(() => splitParagraph(p, 2, old));
});
function fixture() {
  const l = newLibrary(),
    p = newProject("Original"),
    a = {
      id: crypto.randomUUID(),
      title: "Article",
      paragraphs: [paragraph("We were running slowly. It felt good.")],
    };
  p.articles.push(a);
  l.projects.push(p);
  return {
    l,
    p,
    a,
    q: a.paragraphs[0],
    anchor: anchorFor(p, a, a.paragraphs[0], 8, 15),
  };
}
test("partial and reverse selection keeps original apostrophes/hyphens and crosses sentences in one paragraph", () => {
  assert.deepEqual(expandWords("We're well-known. Next sentence.", 12, 8), {
    start: 6,
    end: 16,
    quote: "well-known",
  });
  assert.equal(
    expandWords("First word. Next word.", 8, 14).quote,
    "word. Next",
  );
  assert.equal(expandWords("abc", NaN, 1), null);
  assert.equal(expandWords(" word ", 0, 0), null);
});
test("edited paragraph invalidates exact source and prevents conflicting edits", () => {
  const { l, q, anchor } = fixture();
  assert.equal(resolveAnchor(l, anchor).status, "valid");
  const v = q.currentVersion;
  editParagraph(q, "We were running quickly.", v);
  assert.equal(resolveAnchor(l, anchor).status, "stale");
  assert.equal(q.versions[0].text, "We were running slowly. It felt good.");
  assert.throws(() => editParagraph(q, "late", v));
});
test("same selection idempotent, different context preserved, deleted source snapshot retained", () => {
  const { l, p, a, q, anchor } = fixture();
  const f = saveFavorite(l, anchor, "跑", "run");
  assert.equal(saveFavorite(l, anchor, "跑", "run").id, f.id);
  const other = anchorFor(p, a, q, 31, 35);
  saveFavorite(l, other, "好", "good");
  purgeProject(l, p.id);
  assert.equal(l.favorites.length, 2);
  assert.equal(f.sourceDeleted, true);
  assert.equal(resolveAnchor(l, f.anchor).status, "stale");
});
test("explicit trash policy and seven-day boundary", () => {
  const { l, p, anchor } = fixture();
  saveFavorite(l, anchor, "跑");
  p.deletedAt = "2026-01-01T00:00:00.000Z";
  p.deleteFavorites = true;
  expireTrash(l, Date.parse("2026-01-07T23:59:59Z"));
  assert.equal(l.projects.length, 1);
  expireTrash(l, Date.parse("2026-01-08T00:00:00Z"));
  assert.equal(l.projects.length, 0);
  assert.equal(l.favorites.length, 0);
});
test("review batch is stable after ratings change", () => {
  const fs = [
      { id: "a", rating: "unknown", created: "2026-01-01" },
      { id: "b", rating: "fuzzy", created: "2026-01-02" },
    ],
    ids = reviewBatch(fs);
  fs[0].rating = "known";
  assert.deepEqual(ids, ["a", "b"]);
  assert.deepEqual(reviewBatch(fs), ["b", "a"]);
});
test("cancellation before delay sends nothing; stale response cannot render", async () => {
  let callback,
    calls = 0;
  const resolve = [],
    rendered = [];
  const c = new SelectionController({
    schedule: (fn) => ((callback = fn), 1),
    unschedule: () => (callback = undefined),
    request: (a) => (calls++, new Promise((r) => resolve.push(() => r(a)))),
    render: (r) => rendered.push(r),
  });
  c.choose({ id: "cancel" });
  c.cancel();
  assert.equal(callback, undefined);
  assert.equal(calls, 0);
  c.choose({ id: "old" });
  const first = c.confirm();
  c.choose({ id: "new" });
  const second = c.confirm();
  resolve[1]();
  await second;
  resolve[0]();
  await first;
  assert.deepEqual(
    rendered.map((x) => x.result.id),
    ["new"],
  );
});
test("confirmation mode makes no timer; old failure cannot render", async () => {
  const callbacks = [],
    rendered = [];
  const c = new SelectionController({
    mode: "confirm",
    schedule: () => assert.fail("timer"),
    request: () =>
      new Promise((resolve, reject) => callbacks.push({ resolve, reject })),
    render: (r) => rendered.push(r),
  });
  c.choose({ id: "old" });
  const first = c.confirm();
  c.choose({ id: "new" });
  const second = c.confirm();
  callbacks[0].reject(Error("old"));
  callbacks[1].resolve("new");
  await Promise.all([first, second]);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].result, "new");
});
test("OCR missing mandatory uncertain is rejected without silently marking safe", () => {
  const value = {
    paragraphs: [{ id: "p1", kind: "body", text: "chnage" }],
    notes: [],
    punctuation_suggestions: [],
  };
  assert.throws(() => parseOutput("ocr", JSON.stringify(value)));
  value.paragraphs[0].uncertain = true;
  assert.equal(
    parseOutput("ocr", JSON.stringify(value)).paragraphs[0].text,
    "chnage",
  );
});
test("explanation cannot change source; task/model/version separate cache", () => {
  const { anchor } = fixture();
  assert.throws(() =>
    parseOutput(
      "explain",
      JSON.stringify({
        selection: "run",
        sentence: anchor.sentence.quote,
        meaning_zh: "跑",
      }),
      anchor,
    ),
  );
  assert.notEqual(
    cacheKey("explain", anchor, "flash", "x"),
    cacheKey("structure", anchor, "flash", "x"),
  );
  assert.notEqual(
    cacheKey("explain", anchor, "flash", "x"),
    cacheKey("explain", anchor, "pro", "x"),
  );
});
test("restore remaps all domain references while keeping immutable asset identity", () => {
  const { l, p, anchor } = fixture();
  const asset = {
    id: crypto.randomUUID(),
    mime: "image/png",
    hash: "sha",
    size: 1,
  };
  p.pages.push({ id: crypto.randomUUID(), original: asset, current: asset });
  saveFavorite(l, anchor, "跑");
  const target = newLibrary();
  importAsCopy(target, l);
  assert.notEqual(target.projects[0].id, p.id);
  assert.equal(target.projects[0].pages[0].original.id, asset.id);
  assert.equal(
    resolveAnchor(target, target.favorites[0].anchor).status,
    "valid",
  );
  assert.equal(l.projects[0].id, p.id);
});
test("summary rejects substring, ambiguous duplicate sentence and wrong version", () => {
  const paragraphs = [
    {
      paragraphId: "p",
      versionId: "v",
      text: "One sentence. Another sentence.",
    },
  ];
  const point = (quote) => [
    { citations: [{ paragraphId: "p", versionId: "v", quote }] },
  ];
  assert.throws(() => validateCitations(point("sentence"), paragraphs));
  const valid = point("One sentence.");
  validateCitations(valid, paragraphs);
  assert.equal(valid[0].citations[0].start, 0);
  assert.throws(() =>
    validateCitations(point("One sentence."), [
      { ...paragraphs[0], text: "One sentence. One sentence." },
    ]),
  );
  assert.throws(() =>
    validateCitations(point("One sentence."), [
      { ...paragraphs[0], versionId: "new" },
    ]),
  );
});
test("navigation cancels all in-flight task types and cannot revive late responses", () => {
  const scope = new RequestScope(),
    stopped = [];
  const valid = scope.begin("ocr", () => stopped.push("ocr"));
  scope.begin("summary", () => stopped.push("summary"));
  scope.cancel();
  assert.equal(valid(), false);
  assert.deepEqual(stopped, ["ocr", "summary"]);
  const current = scope.begin("new", () => {});
  scope.finish("new");
  assert.equal(current(), true);
  assert.equal(valid(), false);
});
test("empty source is safely stale", () =>
  assert.equal(resolveAnchor(newLibrary(), {}).status, "stale"));
