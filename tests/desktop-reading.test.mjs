import test from "node:test";
import assert from "node:assert/strict";
import {
  desktopRange,
  desktopSentence,
  readableParts,
  conversation,
  conversationContext,
} from "../src/desktop-reading.mjs";
import {
  newLibrary,
  newProject,
  paragraph,
  anchorFor,
  firstExplanation,
  cacheKey,
  parseOutput,
  editParagraph,
  importAsCopy,
} from "../src/core.mjs";
function fixture() {
  const lib = newLibrary(),
    p = newProject("Independent"),
    pg = paragraph("They train every day. They train again."),
    a = { id: crypto.randomUUID(), title: "Practice", paragraphs: [pg] };
  p.articles.push(a);
  lib.projects.push(p);
  return {
    lib,
    p,
    pg,
    a,
    anchor: { ...anchorFor(p, a, pg, 5, 10), selectionType: "word" },
  };
}
test("three modes: apostrophes, hyphens, reverse phrase and punctuation preserve source", () => {
  const t = "Don't re-write the plan, please. Train again.";
  assert.equal(desktopRange(t, "word", 2).quote, "Don't");
  assert.equal(desktopRange(t, "word", 9).quote, "re-write");
  assert.equal(
    desktopRange(t, "phrase", 29, 8).quote,
    "re-write the plan, please",
  );
  assert.equal(
    desktopRange(t, "sentence", 9).quote,
    "Don't re-write the plan, please.",
  );
  assert.equal(desktopRange(t, "word", 5), null);
  assert.equal(desktopRange(t, "word", 31), null);
});
test("sentence boundaries keep titles and closing quotes, never whole paragraph by default", () => {
  const t = "Dr. Lee said, “Train daily.” Then he left.";
  assert.equal(desktopSentence(t, 6).quote, "Dr. Lee said, “Train daily.”");
  assert.equal(desktopSentence(t, 33).quote, "Then he left.");
  assert.equal(
    desktopSentence("Use e.g. a pen. Then write.", 10).quote,
    "Use e.g. a pen.",
  );
});
test("cache separates explicit selection type, task, context and retains legacy word results", () => {
  const { lib, anchor } = fixture();
  const legacy = { ...anchor };
  delete legacy.selectionType;
  lib.results.push({
    task: "explain",
    anchor: legacy,
    model: "m",
    data: { meaning_zh: "训练" },
  });
  assert.ok(firstExplanation(lib, anchor, "m"));
  assert.equal(
    firstExplanation(lib, { ...anchor, selectionType: "phrase" }, "m"),
    null,
  );
  assert.notEqual(
    cacheKey("explain", anchor, "m", "c"),
    cacheKey("explain", { ...anchor, selectionType: "phrase" }, "m", "c"),
  );
  assert.notEqual(
    cacheKey("explain", anchor, "m", "c"),
    cacheKey("followup", anchor, "m", "c"),
  );
});
test("chat history persists in library, uses full identity, context limited independently, copy remaps", () => {
  const { lib, anchor, pg } = fixture();
  for (let i = 0; i < 9; i++)
    lib.results.push({
      id: crypto.randomUUID(),
      task: "followup",
      anchor,
      question: "q" + i,
      data: { meaning_zh: "a" + i },
    });
  const restart = JSON.parse(JSON.stringify(lib));
  assert.equal(conversation(restart, anchor).length, 9);
  assert.equal(conversationContext(restart, anchor).length, 6);
  assert.equal(
    conversation(restart, { ...anchor, start: 26, end: 31 }).length,
    0,
  );
  assert.equal(
    conversation(restart, { ...anchor, projectId: "other" }).length,
    0,
  );
  editParagraph(pg, "New text.", pg.currentVersion);
  assert.equal(conversation(lib, anchor).length, 9);
  const copy = newLibrary();
  importAsCopy(copy, lib);
  assert.equal(conversation(copy, anchor).length, 0);
  assert.equal(conversation(copy, copy.results[0].anchor).length, 9);
});
test("structured prose readable and optional new fields validated with legacy fallback", () => {
  assert.equal(
    readableParts([{ text: "They train", role: "主谓结构" }]),
    "They train · 主谓结构",
  );
  const { anchor } = fixture(),
    d = {
      selection: anchor.quote,
      sentence: anchor.sentence.quote,
      meaning_zh: "训练",
    };
  assert.equal(
    parseOutput("explain", JSON.stringify(d), anchor).meaning_zh,
    "训练",
  );
  assert.throws(() =>
    parseOutput(
      "explain",
      JSON.stringify({ ...d, other_meanings: [{ pos: 3 }] }),
      anchor,
    ),
  );
});
