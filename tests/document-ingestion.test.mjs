import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTranscript,
  organizeTranscript,
  applyDocument,
  pageSnapshot,
  restoreOrganization,
  validateAnswers,
  rebindAnchors,
} from "../src/document-ingestion.mjs";
import {
  newLibrary,
  newProject,
  paragraph,
  currentText,
  importAsCopy,
  anchorFor,
  saveFavorite,
} from "../src/core.mjs";
const prose =
  "A family decided to walk through the countryside together. They enjoyed the fresh air and learned about the trees and flowers along the way.";
const checks = {
  cross_page_reviewed: true,
  paragraphs_reviewed: true,
  questions_reviewed: true,
};
const fixture = () => ({
  blocks: [
    { id: "b1", text: prose, pageId: "page1", uncertain: false },
    { id: "label", text: "A", pageId: "page1" },
    {
      id: "question",
      text: "1. Where did the family walk?\nA. Countryside. B. Office. C. School. D. Home.",
      pageId: "page2",
    },
  ],
  notes: [],
});
const organization = () => ({
  articles: [
    {
      title: "一家人在乡间步行的故事",
      source_label: "A",
      body: [["b1"]],
      questions: [["question"]],
      sections: [{ name: "标注", block_ids: ["label"] }],
    },
  ],
  extras: [],
  checks,
});
test("whole-document transcription preserves image order and assigns collision-free internal block IDs", () => {
  const pages = [{ id: "p1" }, { id: "p2" }],
    raw = {
      pages: pages.map((p) => ({
        pageId: p.id,
        blocks: [{ id: "b1", text: prose, uncertain: false }],
      })),
    };
  const d = normalizeTranscript(raw, pages);
  assert.equal(new Set(d.blocks.map((b) => b.id)).size, 2);
  assert.deepEqual(
    d.blocks.map((b) => b.pageId),
    ["p1", "p2"],
  );
  assert.throws(() => normalizeTranscript(raw, [...pages].reverse()), /顺序/);
  assert.throws(
    () => normalizeTranscript({ pages: raw.pages.slice(0, 1) }, pages),
    /页数/,
  );
});
test("global organization rejects missing, duplicate and misclassified source blocks", () => {
  const t = fixture(),
    d = organization();
  assert.equal(organizeTranscript(d, t).articles.length, 1);
  d.articles[0].body.push(["b1"]);
  assert.throws(() => organizeTranscript(d, t), /重复归属/);
  d.articles[0].body.pop();
  d.articles[0].questions = [];
  assert.throws(() => organizeTranscript(d, t), /未分配/);
  d.articles[0].body.push(["question"]);
  assert.throws(() => organizeTranscript(d, t), /选择题/);
});
test("standalone labels cannot create articles, while all source text stays recoverable", () => {
  const t = fixture(),
    d = organization();
  d.articles[0].sections = [];
  d.articles.push({ title: "A", body: [["label"]], questions: [] });
  const r = organizeTranscript(d, t);
  assert.equal(r.articles.length, 1);
  assert.equal(r.extras[0].text, "A");
  d.articles[0].title = "文章 A（标题待补充）";
  assert.throws(() => organizeTranscript(d, t), /标题/);
});
test("cross-image fragments form one paragraph and exact splits cannot rewrite or lose text", () => {
  const t = fixture(),
    d = organization();
  t.blocks[0].text = prose + " At the end they saw";
  t.blocks.push({ id: "tail", pageId: "page2", text: "a beautiful river." });
  d.articles[0].body = [["b1", "tail"]];
  const r = organizeTranscript(d, t);
  assert.equal(
    r.articles[0].paragraphs[0].text,
    prose + " At the end they saw a beautiful river.",
  );
  assert.deepEqual(r.articles[0].paragraphs[0].pageIds, ["page1", "page2"]);
  d.articles[0].body = [["b1"], ["tail"]];
  assert.throws(() => organizeTranscript(d, t), /未完句/);
  d.articles[0].body = [["b1#1"], ["b1#2", "tail"]];
  d.splits = [{ block_id: "b1", parts: [prose, "At the end they saw"] }];
  assert.equal(
    organizeTranscript(d, t).articles[0].paragraphs.filter(
      (p) => p.kind === "body",
    ).length,
    2,
  );
  d.splits[0].parts[1] = "At the end they heard";
  assert.throws(() => organizeTranscript(d, t), /改动|遗漏/);
});
test("deduplication requires exact long source equality and keeps the retained block", () => {
  const t = fixture(),
    d = organization();
  t.blocks.push({ ...t.blocks[0], id: "dup", pageId: "page2" });
  d.duplicates = [{ block_id: "dup", same_as: "b1" }];
  assert.equal(organizeTranscript(d, t).duplicates.length, 1);
  t.blocks.at(-1).text += " Changed.";
  assert.throws(() => organizeTranscript(d, t), /一致/);
});
test("batch apply is idempotent, rejects reordered pages and keeps restorable manual edits", () => {
  const p = newProject("Test");
  p.pages = [
    { id: "page1", current: { id: "asset1", mime: "image/jpeg", hash: "h1" } },
    { id: "page2", current: { id: "asset2", mime: "image/jpeg", hash: "h2" } },
  ];
  const original = paragraph(prose);
  p.articles = [
    {
      id: "old",
      title: "Old title",
      paragraphs: [original, paragraph("A manual note.", "other")],
    },
  ];
  const lib = newLibrary();
  lib.projects.push(p);
  const anchor = anchorFor(p, p.articles[0], original, 2, 8);
  lib.lastProject = p.id;
  p.lastSelection = anchor;
  const batch = {
    id: "batch",
    snapshot: pageSnapshot(p),
    data: organizeTranscript(organization(), fixture()),
  };
  p.documentBatch = batch;
  applyDocument(p, batch);
  rebindAnchors(lib, p);
  assert.equal(p.articles[0].paragraphs[0].id, original.id);
  assert.equal(p.lastSelection.articleTitle, p.articles[0].title);
  assert.equal(p.organizationHistory.length, 1);
  applyDocument(p, batch);
  assert.equal(p.organizationHistory.length, 1);
  const copy = newLibrary();
  importAsCopy(copy, lib);
  const cp = copy.projects[0];
  assert.notEqual(cp.id, p.id);
  assert.equal(cp.documentBatch.snapshot, pageSnapshot(cp));
  assert.equal(
    cp.documentBatch.data.articles[0].paragraphs[0].pageId,
    cp.pages[0].id,
  );
  restoreOrganization(cp, cp.organizationHistory[0].id);
  assert.equal(cp.articles[0].title, "Old title");
  assert.equal(currentText(cp.articles[0].paragraphs[1]), "A manual note.");
  assert.equal(cp.documentBatch.applied, false);
  p.pages.reverse();
  assert.throws(() => applyDocument(p, { ...batch, applied: false }), /页序/);
});
test("answers must cover each supplied question in order and cite exact source sentences", () => {
  const body = [{ paragraphId: "p", versionId: "v", text: prose }],
    questions = [{ paragraphId: "q" }];
  const raw = {
    answers: [
      {
        questionId: "q",
        answer: "A. Countryside.",
        explanation: "一家人在乡间散步。",
        uncertain: false,
        citations: [
          {
            paragraphId: "p",
            versionId: "v",
            quote: "A family decided to walk through the countryside together.",
          },
        ],
      },
    ],
  };
  assert.equal(validateAnswers(raw, body, questions).answers.length, 1);
  raw.answers[0].citations[0].quote = "The family walked.";
  assert.throws(() => validateAnswers(raw, body, questions), /原句/);
  raw.answers[0].uncertain = true;
  raw.answers[0].citations = [];
  assert.equal(
    validateAnswers(raw, body, questions).answers[0].uncertain,
    true,
  );
  raw.answers[0].questionId = "wrong";
  assert.throws(() => validateAnswers(raw, body, questions), /归属/);
});

test("one transcription payload carries every ordered image and keeps organization text-only", async () => {
  const { payloadFor } = await import("../src/model.ts");
  const pages = [1, 2, 3, 4].map((i) => ({
    id: "page" + i,
    image: "data:image/jpeg;base64,image" + i,
    name: "sample" + i,
  }));
  const payload = payloadFor(
    "document-transcribe",
    { pages },
    "deepseek-v4-pro",
  );
  const images = payload.messages.flatMap((m) =>
    Array.isArray(m.content)
      ? m.content
          .filter((x) => x.type === "image_url")
          .map((x) => x.image_url.url)
      : [],
  );
  assert.deepEqual(
    images,
    pages.map((p) => p.image),
  );
  assert.equal(payload.model, "deepseek-flash");
  assert.equal(payload.messages.length, 5);
  const organize = payloadFor("document-organize", { transcript: fixture() });
  assert.equal(typeof organize.messages[1].content, "string");
  assert.equal(
    JSON.parse(organize.messages[1].content).transcript.blocks.length,
    3,
  );
});
