import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = ".local/phase2-fixes";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const ws = (a) => page.locator(`[data-ws="${a}"]`),
  ok = (s) => {
    checks.push(s);
    console.log("PASS", s);
  };
try {
  await page.goto("http://127.0.0.1:1420/tests/worksheet-fixture.html");
  await ws("recognize").waitFor();
  assert.equal(await page.locator("#project-ai-usage").isVisible(), false);
  await page.locator('[data-action="settings"]').first().click();
  await page.locator("#show-ai-usage").check();
  await page.locator("#settings-form .primary").click();
  await page.locator("#project-ai-usage").waitFor();
  ok("usage hidden by default, settings opt-in");
  await page.evaluate(() => (qa.truncated = true));
  await ws("recognize").click();
  await page.waitForFunction(
    () => qa.saved().projects[0].worksheetResults?.at(-1)?.status === "failed",
  );
  assert.equal(await page.evaluate(() => qa.calls), 1);
  assert.equal(await page.evaluate(() => qa.budgets[0]), 32000);
  assert.match(await page.locator("#project-ai-usage").innerText(), /120/);
  ok(
    "32000 recognition budget; truncation preserved without duplicate paid retry",
  );
  await page.evaluate(() => (qa.truncated = false));
  await ws("recognize").click();
  await ws("apply").click();
  await page.waitForSelector(".ws-item");
  const original = await page.evaluate(() =>
    JSON.stringify(qa.saved().projects[0].articles),
  );
  await page.locator(".ws-item").first().locator('[data-ws="help"]').click();
  await page.waitForSelector(".ws-help");
  assert.equal(await page.evaluate(() => qa.budgets.at(-1)), 16000);
  assert.match(await page.locator("#project-ai-usage").innerText(), /360/);
  assert.match(await page.locator("#project-ai-usage").innerText(), /\+120/);
  assert.match(await page.locator("#project-ai-usage").innerText(), /40.0%/);
  ok("totals, latest increment, split input/output, weighted cache");
  const calls = await page.evaluate(() => qa.calls);
  await page.locator(".ws-item").first().locator('[data-ws="help"]').click();
  assert.equal(await page.evaluate(() => qa.calls), calls);
  ok("local cached help adds no provider usage");
  await page.evaluate(() => (qa.delay = 1000));
  await page.locator(".ws-item").nth(1).locator('[data-ws="help"]').click();
  const cancel = page.locator('.desktop-toolbar [data-action="cancel"]');
  await cancel.click();
  await page.waitForTimeout(1250);
  assert.ok(await page.evaluate(() => qa.cancelled > 0));
  assert.equal(
    await page.locator(".ws-item").nth(1).locator(".ws-help").count(),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => qa.saved().projects[0].worksheetResults.at(-1).status,
    ),
    "cancelled",
  );
  ok(
    "toolbar global cancel reaches worksheet; late response cannot restore help",
  );
  await page
    .locator(".ws-item")
    .first()
    .locator('[data-ws="remove-item"]')
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".ws-item").length === 17,
  );
  await ws("remove-group").first().click();
  await page.reload();
  await ws("recognize").waitFor();
  assert.ok((await page.locator(".ws-item").count()) < 17);
  assert.equal(
    await page.evaluate(() => JSON.stringify(qa.saved().projects[0].articles)),
    original,
  );
  assert.ok(
    await page.evaluate(
      () => qa.saved().projects[0].worksheetHistory.length > 0,
    ),
  );
  assert.ok(await page.locator("#project-ai-usage").isVisible());
  ok(
    "item/group deletion persists, original and history retained, setting survives reopen",
  );
  await page.screenshot({ path: `${out}/usage-dark.png` });
  await page.locator('[data-action="theme"]').click();
  await page.setViewportSize({ width: 950, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: `${out}/usage-light-narrow.png` });
  ok("narrow light layout");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/checks.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
