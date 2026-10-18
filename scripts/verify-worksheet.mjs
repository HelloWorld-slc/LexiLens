import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = ".local/phase2-evidence";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const ok = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const ws = (action) => page.locator(`[data-ws="${action}"]`),
  wait = () => page.waitForTimeout(450);
const item = (n) => page.locator(".ws-item").nth(n);
async function assist(n) {
  await item(n).locator('[data-ws="help"]').click();
  await page.waitForSelector(".ws-help");
}
try {
  await page.goto("http://127.0.0.1:1420/tests/worksheet-fixture.html");
  await ws("recognize").waitFor();
  assert.equal(await page.evaluate(() => qa.calls), 0);
  await ws("recognize").click();
  await ws("apply").waitFor();
  assert.equal(await page.locator(".ws-item").count(), 0);
  await ws("apply").click();
  await page.waitForSelector(".ws-item");
  assert.equal(await page.locator(".ws-item").count(), 18);
  assert.equal(await page.evaluate(() => qa.calls), 1);
  ok("recognition only, review before apply, mixed tasks");
  await item(1).locator('input[value="o0"]').check();
  await item(1).locator('input[value="o1"]').check();
  assert.equal(await item(1).locator("input:checked").count(), 2);
  ok("multiple selection independent values");
  await item(3).locator('[data-answer="blank"]').nth(0).selectOption("o0");
  await item(3).locator('[data-answer="blank"]').nth(1).selectOption("o0");
  await item(3).locator('[data-answer="form"]').first().fill("takes");
  assert.match(await page.locator(".ws-bank").first().innerText(), /已用 2 次/);
  ok("shared bank repeat allowed and inflected form stored");
  await item(4).locator('[data-answer="blank"]').first().fill("learned");
  await item(4).locator('[data-answer="blank"]').last().fill("The");
  await item(6).locator("textarea").fill("To read and exchange ideas.");
  await wait();
  await page.reload();
  await page.waitForSelector(".ws-item");
  assert.equal(
    await item(6).locator("textarea").inputValue(),
    "To read and exchange ideas.",
  );
  assert.equal(await item(1).locator("input:checked").count(), 2);
  assert.equal(
    await item(3).locator('[data-answer="form"]').first().inputValue(),
    "takes",
  );
  assert.equal(await page.evaluate(() => qa.calls), 0);
  ok("reopen restores answers without requests");
  assert.ok((await page.locator(".ws-blank-markers").count()) > 0);
  await item(4).locator('[data-ws="blank"]').first().click();
  assert.ok(await page.evaluate(() => CSS.highlights.has("worksheet-0")));
  await page.locator('.ws-source-markers [data-ws="return"]').click();
  await page.locator('.ws-blank-markers [data-ws="return"]').first().click();
  ok("blank positions and response areas navigate in both directions");
  await assist(0);
  assert.equal(
    await item(0).locator(".ws-help details").nth(1).getAttribute("open"),
    null,
  );
  await item(0).getByText("完整讲解与来源", { exact: true }).click();
  await ws("option").first().click();
  assert.ok(await page.evaluate(() => CSS.highlights.has("worksheet-0")));
  await ws("return").filter({ hasText: "A ·" }).click();
  await ws("compare").click();
  assert.ok((await page.locator(".ws-source-markers button").count()) >= 3);
  assert.ok(await page.evaluate(() => CSS.highlights.has("worksheet-2")));
  ok(
    "evidence both directions, shared sentence and cross-paragraph comparison",
  );
  await assist(0);
  assert.equal(await page.evaluate(() => qa.calls), 1);
  ok("cached help does not call model");
  await assist(10);
  await item(10).getByText("参考答案", { exact: true }).click();
  assert.match(
    await item(10).locator(".ws-help").innerText(),
    /直接采用原文表达/,
  );
  await item(10).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/translation-dark.png` });
  await assist(13);
  await item(13).getByText("参考答案", { exact: true }).click();
  assert.match(
    await item(13).locator(".ws-help").innerText(),
    /根据原文表达调整/,
  );
  await assist(14);
  await item(14).getByText("参考答案", { exact: true }).click();
  assert.match(await item(14).locator(".ws-help").innerText(), /未找到可确认/);
  ok("translation original, adaptation and absent expression");
  await item(6).locator('[data-ws="feedback"]').click();
  await page.waitForSelector(".ws-help");
  assert.match(await item(6).locator(".ws-help").innerText(), /非正式评分/);
  ok("short-answer alternative accepted as reference feedback");
  await page.evaluate(() => (qa.delay = 1400));
  await item(5).locator('[data-ws="help"]').click();
  await ws("cancel").click();
  await page.waitForTimeout(1700);
  assert.equal(await item(5).locator(".ws-help").count(), 0);
  ok("cancel rejects late successful response");
  await page.evaluate(() => {
    qa.delay = 100;
    qa.fail = true;
  });
  await item(5).locator('[data-ws="help"]').click();
  await wait();
  assert.equal(await item(5).locator(".ws-help").count(), 0);
  await page.evaluate(() => (qa.fail = false));
  ok("network failure preserves student answers");
  await item(0).locator('[data-ws="edit"]').click();
  await page.locator('[name="number"]').fill("101");
  await page
    .locator('#ws-edit button[type="submit"], #ws-edit button.primary')
    .click();
  await item(0).waitFor();
  assert.match(await item(0).locator("h4").innerText(), /101/);
  await assist(0);
  ok("manual correction versions question and invalidates help cache");
  await item(0).getByText("完整讲解与来源", { exact: true }).click();
  await item(0).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/worksheet-dark.png` });
  await page.locator('[data-action="theme"]').click();
  await page.setViewportSize({ width: 950, height: 800 });
  await item(3).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/bank-light-narrow.png` });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  ok("light narrow layout without horizontal page overflow");
  const beforeInvalid = await page.evaluate(() => qa.calls);
  await page.evaluate(() => {
    qa.invalid = true;
  });
  await item(5).locator('[data-ws="help"]').click();
  await wait();
  assert.equal(await page.evaluate(() => qa.calls), beforeInvalid + 2);
  assert.equal(
    await page.evaluate(
      () => qa.saved().projects[0].worksheetResults.at(-1).attempts.length,
    ),
    2,
  );
  await page.evaluate(() => {
    qa.invalid = false;
    qa.delay = 1400;
  });
  ok("bounded repair preserves both failed originals");
  await item(5).locator('[data-ws="help"]').click();
  await page.locator('[data-action="home"]').first().click();
  await page
    .locator(".project-card")
    .filter({ hasText: "合成学案实验 B" })
    .locator('[data-action="open-project"]')
    .first()
    .click();
  assert.equal(await page.locator(".ws-item").count(), 0);
  await page.waitForTimeout(1700);
  assert.equal(await page.locator(".ws-help").count(), 0);
  assert.equal(
    await page.evaluate(
      () => qa.saved().projects[0].worksheetResults.at(-1).status,
    ),
    "cancelled",
  );
  ok("cross-project answers isolated");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/checks.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
