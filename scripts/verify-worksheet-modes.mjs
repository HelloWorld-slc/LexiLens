import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = ".local/worksheet-modes";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const ws = (action) => page.locator(`[data-ws="${action}"]`);
const item = (n) => page.locator(".ws-item").nth(n);
const ok = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function neutral(n, selector) {
  const styles = await item(n)
    .locator(`.ws-options ${selector}`)
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        letter: getComputedStyle(node.querySelector("b")).color,
        text: getComputedStyle(node.querySelector("span")).color,
        border: getComputedStyle(node).borderLeftColor,
      })),
    );
  assert.ok(styles.length);
  for (const s of styles) {
    assert.equal(s.letter, s.text);
    assert.equal(s.border, "rgba(0, 0, 0, 0)");
  }
}
async function help(n) {
  await item(n).locator('[data-ws="help"]').click();
  await item(n).locator(".ws-help").waitFor();
}
async function analysis(n) {
  await item(n).locator("[data-ws-analysis] > summary").click();
  await page.waitForTimeout(80);
}
try {
  await page.goto("http://127.0.0.1:1420/tests/worksheet-fixture.html");
  await ws("recognize").click();
  await ws("apply").click();
  await item(0).waitFor();
  assert.equal(await ws("mode-practice").getAttribute("aria-pressed"), "true");
  await neutral(0, "label");
  await item(0).locator('input[value="o1"]').check();
  await neutral(0, "label");
  await item(6).locator("textarea").fill("My saved draft.");
  ok("default practice and selected options are neutral; drafts saved");
  await help(0);
  assert.equal(
    await item(0).locator("[data-ws-reference]").getAttribute("open"),
    null,
  );
  await neutral(0, "label");
  await analysis(0);
  assert.ok(
    await item(0).evaluate((el) => el.classList.contains("ws-analysis-open")),
  );
  const colors = await item(0)
    .locator(".ws-options b")
    .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).color));
  assert.equal(new Set(colors).size, 4);
  await item(0).locator('[data-ws="option"]').first().click();
  assert.ok(await page.evaluate(() => CSS.highlights.has("worksheet-0")));
  await analysis(0);
  await neutral(0, "label");
  assert.equal(await page.locator(".ws-source-markers").count(), 0);
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("worksheet-0")),
    false,
  );
  await item(0).locator('[data-ws="back"]').click();
  assert.equal(await item(0).locator(".ws-help").count(), 0);
  ok(
    "analysis enables four colors/evidence; collapse or back returns neutral practice",
  );
  const calls = await page.evaluate(() => qa.calls);
  await ws("mode-answers").click();
  await item(0).locator("[data-ws-reference][open]").waitFor();
  assert.equal(await page.evaluate(() => qa.calls), calls);
  assert.equal(await page.locator(".ws-item [data-answer]").count(), 0);
  assert.equal(
    await item(0).locator("[data-ws-analysis]").getAttribute("open"),
    null,
  );
  await neutral(0, ".ws-option");
  await item(0).locator(".ws-option").first().click();
  assert.equal(await page.locator(".ws-source-markers").count(), 0);
  ok(
    "answer mode displays saved answers, hides all response controls, no automatic requests/colors",
  );
  await help(1);
  assert.equal(await page.evaluate(() => qa.calls), calls + 1);
  assert.ok(
    await item(1)
      .locator("[data-ws-reference]")
      .evaluate((el) => el.open),
  );
  assert.ok(
    await item(0)
      .locator("[data-ws-reference]")
      .evaluate((el) => el.open),
  );
  await analysis(0);
  await item(0).locator(".ws-option").first().click();
  const id0 = await item(0).getAttribute("id");
  assert.match(
    await page
      .locator('.ws-source-markers [data-ws="return"]')
      .first()
      .getAttribute("data-target"),
    new RegExp(id0.replace("ws-item-", "")),
  );
  await analysis(1);
  await item(1).locator('[data-ws="option"]').first().click();
  const id1 = await item(1).getAttribute("id");
  assert.match(
    await page
      .locator('.ws-source-markers [data-ws="return"]')
      .first()
      .getAttribute("data-target"),
    new RegExp(id1.replace("ws-item-", "")),
  );
  ok(
    "uncached answers requested one at a time; multiple visible answers retain correct evidence owner",
  );
  await help(10);
  assert.match(
    await item(10).locator("[data-ws-reference]").innerText(),
    /直接采用原文表达/,
  );
  await page.reload();
  await item(10).locator("[data-ws-reference][open]").waitFor();
  assert.equal(await page.evaluate(() => qa.calls), 0);
  assert.equal(await ws("mode-answers").getAttribute("aria-pressed"), "true");
  ok("answer mode and contextual translation restore from cache after reopen");
  await item(0).locator('[data-ws="back"]').click();
  await item(6).locator("textarea").waitFor();
  assert.equal(
    await item(6).locator("textarea").inputValue(),
    "My saved draft.",
  );
  assert.equal(await item(0).locator('input[value="o1"]').isChecked(), true);
  assert.equal(await page.locator(".ws-reference").count(), 0);
  await neutral(0, "label");
  ok(
    "return to practice restores previous answers and hides reference answers",
  );
  await ws("mode-answers").click();
  await page.locator('[data-action="home"]').first().click();
  await page
    .locator(".project-card")
    .filter({ hasText: "合成学案实验 B" })
    .locator('[data-action="open-project"]')
    .first()
    .click();
  assert.equal(await ws("mode-practice").getAttribute("aria-pressed"), "true");
  await page.locator('[data-action="home"]').first().click();
  await page
    .locator(".project-card")
    .filter({ hasText: "合成学案实验 A" })
    .locator('[data-action="open-project"]')
    .first()
    .click();
  assert.equal(await ws("mode-answers").getAttribute("aria-pressed"), "true");
  ok("mode preference is isolated per project");
  await page.evaluate(() => (qa.delay = 1200));
  await item(4).locator('[data-ws="help"]').click();
  await ws("cancel").waitFor();
  await ws("mode-practice").click();
  await page.waitForTimeout(1500);
  assert.equal(
    await page.evaluate(
      () => qa.saved().projects[0].worksheetResults.at(-1).status,
    ),
    "cancelled",
  );
  assert.equal(await item(4).locator(".ws-help").count(), 0);
  assert.equal(
    await item(6).locator("textarea").inputValue(),
    "My saved draft.",
  );
  ok(
    "mode switch cancels pending request and rejects late answer without losing draft",
  );
  await page.locator(".ws-modes").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/practice-dark.png` });
  await ws("mode-answers").click();
  await page.locator(".ws-modes").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/answers-dark.png` });
  await analysis(0);
  await item(0).locator('[data-ws="option"]').first().click();
  await page.locator('.ws-source-markers [data-ws="return"]').first().click();
  await item(0).locator(".ws-options").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/analysis-dark.png` });
  await page.locator('[data-action="theme"]').click();
  await page.setViewportSize({ width: 950, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await analysis(0);
  await item(0).locator(".ws-options").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/analysis-light-narrow.png` });
  ok("dark and narrow light layouts remain readable");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/checks.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
