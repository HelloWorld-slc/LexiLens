import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOcr,
  previousPageContext,
  validateContinuations,
  applyOcrPage,
} from "../src/ingestion.mjs";
import {
  newProject,
  newLibrary,
  importAsCopy,
  parseOutput,
  validateParagraphSummary,
  paragraphSummary,
  editParagraph,
} from "../src/core.mjs";

function page(id, text, continuation) {
  const parsed = normalizeOcr({
    articles: [{ id: "A", title: "示例文章", continuation_of: continuation }],
    paragraphs: [{ id: 1, article: "A", text, kind: "body", uncertain: false }],
  });
  return {
    id,
    current: { id: `image-${id}`, mime:'image/jpeg', hash:`hash-${id}` },
    ocr: { assetId: `image-${id}`, parsed },
  };
}
test("OCR repairs metadata without rewriting text or dropping unknown content", () => {
  const d = normalizeOcr({
    data: {
      article_count: 99,
      articles: [{ id: 1, title: "A", body_ids: ["1"], sections: [] }],
      blocks: [
        {
          id: 1,
          article: 1,
          type: "paragraph",
          content: " Printed wording.  ",
          uncertain: "false",
        },
        { id: 2, article: 1, type: "unknown", content: "1. A question?" },
      ],
    },
  });
  assert.equal(d.article_count, 1);
  assert.equal(d.paragraphs[0].text, " Printed wording.  ");
  assert.equal(d.paragraphs[0].uncertain, false);
  assert.equal(d.paragraphs[1].uncertain, true);
  assert.deepEqual(d.articles[0].body_ids, ["1"]);
  assert.equal(d.articles[0].sections[0].block_ids[0], "2");
  assert.throws(() => normalizeOcr({ paragraphs: [{ id: "p", text: "" }] }));
  assert.throws(() =>
    normalizeOcr({
      paragraphs: [
        { id: "p", text: "A" },
        { id: "p", text: "B" },
      ],
    }),
  );
});
test("nested article paragraphs retain grouping", () => {
  const d = normalizeOcr({
    articles: [
      { id: "A", title: "One", paragraphs: [{ text: "First.", kind: "body" }] },
      {
        id: "B",
        title: "Two",
        paragraphs: [{ text: "Second.", kind: "body" }],
      },
    ],
  });
  assert.equal(d.articles.length, 2);
  assert.deepEqual(
    d.paragraphs.map((p) => p.article),
    ["A", "B"],
  );
});
test("backup copy preserves local OCR labels and redirects pending continuations to copied articles", () => {
  const source = newLibrary(),
    target = newLibrary(),
    p = newProject();
  source.projects.push(p);
  p.pages.push(
    page("1", "First."),
    page("2", "Second.", {
      pageId: "1",
      articleId: "A",
      reason: "continuation",
    }),
  );
  applyOcrPage(p, p.pages[0]);
  p.pages[1].ocr.previous = previousPageContext(p, p.pages[1]);
  importAsCopy(target, source);
  const restored = target.projects[0];
  assert.notEqual(restored.id, p.id);
  assert.equal(restored.pages[0].ocr.parsed.articles[0].id, "A");
  assert.equal(restored.pages[0].ocr.articleMap.A, restored.articles[0].id);
  assert.equal(
    restored.pages[1].ocr.parsed.articles[0].continuation_of.pageId,
    restored.pages[0].id,
  );
  applyOcrPage(restored, restored.pages[1]);
  assert.equal(restored.articles.length, 1);
  assert.equal(restored.articles[0].paragraphs.length, 2);
  assert.equal(p.articles[0].paragraphs.length, 1);
});
test("empty AI placeholders do not fail a populated page or create phantom articles", () => {
  const d = normalizeOcr({
    articles: [
      { id: "A", title: "Text" },
      { id: "B", title: "Empty" },
    ],
    paragraphs: [
      { id: "a", article: "A", kind: "body", text: "Actual text." },
      { id: "b", article: "B", kind: "question", text: "" },
    ],
  });
  assert.equal(d.article_count, 1);
  assert.equal(d.paragraphs.length, 1);
  assert.ok(d.notes.length);
});
test("two and three-page continuations append once, preserving paragraph versions and source pages", () => {
  const p = newProject("test");
  p.pages.push(
    page("1", "First sentence."),
    page("2", "Second sentence.", {
      pageId: "1",
      articleId: "A",
      reason: "Same narrative continues",
    }),
    page("3", "Third sentence.", {
      pageId: "2",
      articleId: "A",
      reason: "Final paragraph",
    }),
  );
  assert.throws(() => applyOcrPage(p, p.pages[1]), /先核对/);
  assert.equal(p.articles.length, 0);
  applyOcrPage(p, p.pages[0]);
  const version = p.articles[0].paragraphs[0].currentVersion;
  applyOcrPage(p, p.pages[1]);
  applyOcrPage(p, p.pages[2]);
  applyOcrPage(p, p.pages[1]);
  assert.equal(p.articles.length, 1);
  assert.equal(p.articles[0].paragraphs.length, 3);
  assert.equal(p.articles[0].paragraphs[0].currentVersion, version);
  assert.deepEqual(
    p.articles[0].paragraphs.map((p) => p.pageId),
    ["1", "2", "3"],
  );
});
test("different articles stay separate and invalid/reordered continuation references are rejected", () => {
  const p = newProject();
  p.pages.push(page("1", "First."), page("2", "Another."));
  for (const pg of p.pages) applyOcrPage(p, pg);
  assert.equal(p.articles.length, 2);
  const third = page("3", "Last.", {
    pageId: "1",
    articleId: "A",
    reason: "wrong previous page",
  });
  p.pages.push(third);
  assert.throws(() =>
    validateContinuations(third.ocr.parsed, previousPageContext(p, third)),
  );
  third.ocr.parsed.articles[0].continuation_of.pageId = "2";
  third.ocr.previous = previousPageContext(p, third);
  p.pages[1].current.id = "edited-image";
  assert.throws(() => applyOcrPage(p, third), /变化/);
});
test("lookup accepts typography and whitespace echoes but rejects different source words", () => {
  const anchor = {
    quote: "author’s",
    sentence: { quote: "The author’s book is “new”.  " },
  };
  const response = {
    selection: "author's",
    sentence: 'The author\'s book is "new".',
    meaning_zh: "作者的",
  };
  const d = parseOutput("explain", JSON.stringify(response), anchor);
  assert.equal(d.selection, anchor.quote);
  assert.equal(d.sentence, anchor.sentence.quote);
  assert.throws(() =>
    parseOutput(
      "explain",
      JSON.stringify({ ...response, selection: "book" }),
      anchor,
    ),
  );
  assert.throws(() =>
    parseOutput(
      "explain",
      JSON.stringify({ ...response, sentence: "The author’s book is old." }),
      anchor,
    ),
  );
});
test("paragraph summaries require every paragraph and disappear after source edits", () => {
  const p = newProject();
  p.pages.push(
    page("1", "First sentence."),
    page("2", "Second sentence.", {
      pageId: "1",
      articleId: "A",
      reason: "continuation",
    }),
  );
  for (const pg of p.pages) applyOcrPage(p, pg);
  const a = p.articles[0],
    paragraphs = a.paragraphs.map((pg) => ({
      paragraphId: pg.id,
      versionId: pg.currentVersion,
      text: pg.versions[0].text,
    }));
  const d = {
    summary: "摘要",
    points: paragraphs.map((pg) => ({
      text: "逐段要点",
      inference: false,
      citations: [
        {
          paragraphId: pg.paragraphId,
          versionId: pg.versionId,
          quote: pg.text,
        },
      ],
    })),
  };
  validateParagraphSummary(d, paragraphs);
  assert.throws(() =>
    validateParagraphSummary(
      { ...d, points: d.points.slice(0, 1) },
      paragraphs,
    ),
  );
  const results = [
    { projectId: p.id, articleId: a.id, task: "summary", data: d },
  ];
  assert.equal(
    paragraphSummary(results, p.id, a.id, a.paragraphs[0]),
    "逐段要点",
  );
  editParagraph(a.paragraphs[0], "Changed.", a.paragraphs[0].currentVersion);
  assert.equal(paragraphSummary(results, p.id, a.id, a.paragraphs[0]), "");
});
