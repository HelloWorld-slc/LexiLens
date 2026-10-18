import test from "node:test";
import assert from "node:assert/strict";
import { fixture, seedStructured, help } from "./worksheet-fixture.mjs";
import {
  material,
  locate,
  validateGroups,
  validateHelp,
  requestInput,
  isCurrent,
  cacheMatch,
  saveAttempt,
  attempt,
  issues,
} from "../src/worksheet.mjs";
import { editParagraph, importAsCopy, newLibrary } from "../src/core.mjs";
test("mixed recognition retains six translation combinations and incomplete questions without answers", () => {
  const { a, groups } = fixture();
  groups[0].items[0].answer = "must not persist";
  const g = validateGroups({ groups }, a);
  assert.equal(g[6].items.length, 8);
  assert.equal(g[0].items[0].answer, undefined);
  assert.match(
    issues(g[7], g[7].items[0]).join(" "),
    /题号缺失.*选项可能不完整/,
  );
  assert.equal(g[2].reuse, "yes");
  assert.equal(g[3].items[0].blanks[1].hint, "");
});
test("typed enums, foreign options and missing child answers are rejected", () => {
  const { a, groups } = fixture();
  groups[0].items[0].kind = "random";
  assert.throws(() => validateGroups({ groups }, a), /题型/);
  const f = seedStructured(),
    g = f.p.worksheets[1],
    q = g.items[0],
    input = requestInput(g, q, f.a),
    d = help(input);
  d.parts = [];
  assert.throws(() => validateHelp(d, input, "worksheet-help"), /空位/);
  d.parts = help(input).parts;
  d.options[0].id = "foreign";
  assert.throws(() => validateHelp(d, input, "worksheet-help"), /选项/);
});
test("all supported task fixtures validate their reference help", () => {
  const f = seedStructured();
  for (const g of f.p.worksheets)
    for (const q of g.items) {
      const input = requestInput(g, q, f.a);
      assert.equal(
        validateHelp(help(input), input, "worksheet-help").itemId,
        q.id,
      );
    }
});
test("citation rejects missing, foreign, stale and ambiguous text; exact repeated offset accepted", () => {
  const { a, ref } = fixture(),
    ps = material(a);
  assert.throws(() => locate(ref(0, "invented"), ps));
  assert.throws(() => locate({ ...ref(0, "club"), articleId: "other" }, ps));
  assert.throws(() => locate({ ...ref(0, "club"), versionId: "old" }, ps));
  assert.throws(() => locate(ref(0, "club"), ps), /重复/);
  const r = locate(
    { ...ref(0, "club"), start: ps[0].text.indexOf("club") },
    ps,
  );
  assert.equal(r.end - r.start, 4);
});
test("translation distinguishes exact, adapted and missing source; fabricated originals rejected", () => {
  const f = seedStructured(),
    g = f.p.worksheets[6];
  for (const stem of ["参加", "她昨天参加了俱乐部。", "太空电梯"]) {
    const q = g.items.find((q) => q.stem === stem),
      input = requestInput(g, q, f.a);
    const d = validateHelp(help(input), input, "worksheet-help");
    assert.equal(
      d.translation.mode,
      stem === "参加" ? "exact" : stem === "太空电梯" ? "none" : "adapted",
    );
    if (d.translation.mode === "adapted") {
      d.translation.mode = "exact";
      assert.throws(() => validateHelp(d, input, "worksheet-help"), /原文表达/);
    }
  }
});
test("reference feedback allows acceptable alternatives and undetermined; no numeric grading", () => {
  const f = seedStructured(),
    g = f.p.worksheets[5],
    q = g.items[0],
    input = requestInput(g, q, f.a);
  for (const category of ["acceptable", "wording", "undetermined"])
    assert.equal(
      validateHelp(
        {
          itemId: q.id,
          category,
          feedback: "表达不同但可以接受",
          reason: "意义相同",
          citations: [],
        },
        input,
        "worksheet-feedback",
      ).category,
      category,
    );
});
test("source edit invalidates groups and model-specific caches without rewriting history", () => {
  const f = seedStructured(),
    g = f.p.worksheets[0],
    q = g.items[0],
    input = requestInput(g, q, f.a),
    r = {
      task: "worksheet-help",
      model: "flash",
      promptVersion: 1,
      input,
      data: help(input),
    };
  assert.ok(isCurrent(g, f.a));
  assert.ok(cacheMatch(r, "worksheet-help", input, "flash"));
  assert.ok(!cacheMatch(r, "worksheet-help", input, "pro"));
  assert.ok(!cacheMatch(r, "worksheet-feedback", input, "flash"));
  editParagraph(
    f.a.paragraphs[0],
    "New source",
    f.a.paragraphs[0].currentVersion,
  );
  assert.ok(!isCurrent(g, f.a));
  assert.ok(!cacheMatch(r, "worksheet-help", requestInput(g, q, f.a), "flash"));
  assert.equal(r.input.paragraphs[0].text, input.paragraphs[0].text);
});
test("answers survive reopen, multi-select and changed word forms with project isolation", () => {
  const f = seedStructured(),
    g = f.p.worksheets[0],
    q = g.items[1];
  saveAttempt(f.p, g, q, { selected: ["o0", "o1"] });
  const restored = JSON.parse(JSON.stringify(f.lib));
  assert.deepEqual(attempt(restored.projects[0], g, q).value.selected, [
    "o0",
    "o1",
  ]);
  assert.equal(attempt(restored.projects[1], g, q), undefined);
  assert.equal(f.p.worksheets[0].items[1].answer, undefined);
});
test("backup copy remaps material, question IDs, selected choices and blank keys", () => {
  const f = seedStructured(),
    g = f.p.worksheets[2],
    q = g.items[0];
  saveAttempt(f.p, g, q, {
    blanks: { b1: "o0", b2: "o1" },
    forms: { b1: "takes" },
  });
  const dst = importAsCopy(newLibrary(), f.lib),
    p = dst.projects[0],
    ng = p.worksheets[2],
    nq = ng.items[0],
    v = attempt(p, ng, nq).value;
  assert.notEqual(p.id, f.p.id);
  assert.ok(isCurrent(ng, p.articles[0]));
  assert.equal(v.blanks[nq.blanks[0].id], ng.options[0].id);
  assert.equal(v.forms[nq.blanks[0].id], "takes");
});
test("legacy libraries import without worksheets or silent migration", () => {
  const f = fixture();
  const dst = importAsCopy(newLibrary(), f.lib);
  assert.equal(dst.projects[0].worksheets, undefined);
  assert.equal(dst.projects[0].articles[0].paragraphs.at(-1).kind, "question");
});
