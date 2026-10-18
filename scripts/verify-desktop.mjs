import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.env.LEXILENS_QA_OUTPUT || ".local/phase1-evidence";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const ok = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const click = (a) => page.locator(`[data-action="${a}"]`).last().click();
const wait = () => page.waitForTimeout(600);
async function point(word, occurrence = 0, paragraph = 0) {
  return page
    .locator(".paragraph")
    .nth(paragraph)
    .evaluate(
      (el, { word, occurrence }) => {
        const text = el.firstChild;
        let pos = -1;
        for (let i = 0; i <= occurrence; i++)
          pos = text.textContent.indexOf(word, pos + 1);
        if (pos < 0) throw Error("Missing word");
        const r = document.createRange();
        r.setStart(text, pos + 1);
        r.setEnd(text, pos + 2);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 3, y: b.y + b.height / 2 };
      },
      { word, occurrence },
    );
}
async function select(word, occurrence = 0) {
  const p = await point(word, occurrence);
  await page.mouse.click(p.x, p.y);
  await wait();
}
const calls = () => page.evaluate(() => qa.calls);
try {
  await page.goto("http://127.0.0.1:1420/tests/desktop-fixture.html");
  await page.waitForSelector(".paragraph");
  assert.equal(await page.locator(".project-nav-row").count(), 1);
  ok("current project navigation");
  let p = await point("train");
  await page.mouse.move(p.x, p.y);
  await wait();
  assert.equal(await calls(), 0);
  assert.ok(await page.evaluate(() => CSS.highlights.has("reading-preview")));
  ok("hover preview zero requests");
  await select("train");
  assert.equal(await calls(), 0);
  await click("explain");
  await wait();
  assert.match(await page.locator(".context-meaning").innerText(), /v. 训练/);
  const base = await page.locator(".context-meaning").innerText();
  await page.evaluate(
    () => (document.querySelector("#panel-content").scrollTop = 0),
  );
  await page.screenshot({ path: `${out}/word-dark.png` });
  for (const q of ["为什么这里是动词？", "请再举一个例子。"]) {
    await page.locator("#followup").fill(q);
    await click("followup");
    await wait();
  }
  assert.equal(await page.locator(".chat-turn").count(), 2);
  assert.equal(await page.locator(".context-meaning").innerText(), base);
  ok("two independent chat turns, stable base explanation");
  await click("favorite");
  const saved = await page.evaluate(() => qa.saved());
  assert.equal(saved.favorites.length, 1);
  assert.equal(
    saved.favorites[0].meaning,
    "这里表示通过反复练习来训练、培养能力。",
  );
  ok("favorite uses base explanation not reply");
  await page.locator("#followup").fill("失败后重试");
  await page.evaluate(() => (qa.fail = true));
  await click("followup");
  await wait();
  assert.equal(await page.locator("#followup").inputValue(), "失败后重试");
  assert.equal(await page.locator(".chat-turn").count(), 3);
  await page.evaluate(() => (qa.fail = false));
  await click("retry-chat");
  await wait();
  assert.equal(await page.locator(".chat-turn").count(), 3);
  ok("failure preserves draft and retry reuses message");
  await page.reload();
  await page.waitForSelector(".chat-turn");
  assert.equal(await page.locator(".chat-turn").count(), 3);
  assert.equal(await calls(), 0);
  ok("restart restores all turns without generation");
  await select("train");
  assert.equal(await calls(), 0);
  ok("reselect uses cache");
  await select("train", 1);
  assert.equal(await page.locator(".chat-turn").count(), 0);
  ok("same word different location isolated");
  await page.evaluate(() => (qa.delay = 1000));
  await click("explain");
  await page.waitForTimeout(100);
  await click("mode-sentence");
  await wait();
  await wait();
  assert.doesNotMatch(
    await page.locator(".context-meaning").innerText(),
    /训练/,
  );
  ok("mode switch discards in-flight response");
  await select("train");
  await page.evaluate(() => (qa.delay = 180));
  await click("explain");
  await wait();
  assert.equal(
    await page.locator(".sentence-original").innerText(),
    "Dr. Lee said, “We train every day.”",
  );
  await page.evaluate(
    () => (document.querySelector("#panel-content").scrollTop = 0),
  );
  await page.screenshot({ path: `${out}/sentence-dark.png` });
  ok("sentence UI and abbreviation/quote boundary");
  await click("mode-phrase");
  let start = await point("patience"),
    end = await point("again");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await wait();
  assert.equal(
    await page.locator(".insight-title").innerText(),
    "again, with patience",
  );
  await click("explain");
  await wait();
  ok("reverse phrase drag snaps words preserving punctuation");
  await click("theme");
  await page.evaluate(
    () => (document.querySelector("#panel-content").scrollTop = 0),
  );
  await page.screenshot({ path: `${out}/phrase-light.png` });
  await page.setViewportSize({ width: 900, height: 800 });
  await wait();
  await page.screenshot({ path: `${out}/narrow-light.png` });
  assert.equal(await page.locator(".reading-modes button:visible").count(), 3);
  await click("more");
  await page.screenshot({ path: `${out}/more-light.png` });
  assert.match(await page.locator("#dialog").innerText(), /多段分析/);
  await click("close-dialog");
  ok("wide and narrow toolbar/menu with three visible modes");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await click("home");
  const ids = await page.evaluate(() => qa.saved().projects.map((p) => p.id));
  await page
    .locator(`[data-action="open-project"][data-id="${ids[1]}"]`)
    .first()
    .click();
  await wait();
  assert.equal(await page.locator(".chat-turn").count(), 0);
  await select("train");
  assert.equal(await page.locator(".chat-turn").count(), 0);
  ok("project switch isolates selection and chat");
  await click("home");
  await page
    .locator(`[data-action="open-project"][data-id="${ids[0]}"]`)
    .first()
    .click();
  await wait();
  assert.equal(
    await page
      .locator('[data-action="mode-phrase"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  ok("last mode persisted");
  // Auto mode is separately exercised, including waiting cancellation and late result isolation.
  await page.evaluate(() => {
    const d = qa.saved();
    d.settings.mode = "auto";
    d.settings.delay = 1500;
    d.projects[0].lastSelection = null;
    localStorage.setItem("phase1-fixture", JSON.stringify(d));
  });
  await page.reload();
  await page.waitForSelector(".paragraph");
  await click("mode-word");
  await select("well-trained");
  await click("cancel");
  await wait();
  assert.equal(await calls(), 0);
  ok("automatic delay can be cancelled before request");
  await select("reader");
  await page.waitForTimeout(2000);
  assert.equal(await calls(), 1);
  ok("confirmed automatic selection triggers one request");
  // Fixed cancellation stays discoverable while idle; automatic mode omits redundant explain.
  assert.equal(
    await page.locator('.toolbar [data-action="cancel"]').count(),
    1,
  );
  assert.ok(await page.locator('.toolbar [data-action="cancel"]').isDisabled());
  assert.equal(
    await page.locator('.toolbar [data-action="explain"]').count(),
    0,
  );
  ok("icon quick actions: fixed idle cancellation, contextual explain");
  await page.evaluate(() => (qa.delay = 1000));
  await select("care");
  await page.waitForTimeout(1000);
  await select("patience");
  await page.waitForTimeout(2000);
  assert.equal(await page.locator(".insight-title").innerText(), "patience");
  ok("rapid reselection ignores old response");
  await click("structure");
  await page.waitForTimeout(1300);
  assert.doesNotMatch(
    await page.locator(".context-meaning").innerText(),
    /独立的对话/,
  );
  ok("structure remains separate from base explanation");
  // Editing creates a new version; old chat is retained and labelled instead of rebound.
  await page.locator("#followup").fill("保留在旧版本");
  await click("followup");
  await page.waitForTimeout(1300);
  await page.locator('[data-action="edit-paragraph"]').first().click();
  await page
    .locator("#paragraph-text")
    .fill("A revised paragraph keeps its own context.");
  await page.locator("#paragraph-form button.primary").click();
  await wait();
  assert.match(await page.locator(".reading-insight").innerText(), /旧版语境/);
  assert.ok(await page.locator('[data-action="followup"]').isDisabled());
  ok("old version history remains readable and cannot send as new context");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/browser-report.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
