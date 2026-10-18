import test from "node:test";
import assert from "node:assert/strict";
import { projectUsage } from "../src/ai-usage.mjs";
test("project totals include failed attempts and repairs once, isolate projects and weight cache by input", () => {
  const a = {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_cache_hit_tokens: 40,
  };
  const b = {
    prompt_tokens: 300,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 200 },
  };
  const p = {
    id: "p",
    worksheetResults: [{ status: "failed", attempts: [{ usage: b }] }],
    aiLastUsage: { usage: b },
  };
  const lib = {
    tasks: [
      { projectId: "p", usage: { initial: a, repair: a } },
      { projectId: "other", usage: b },
    ],
    results: [{ usage: a }],
  };
  assert.deepEqual(projectUsage(lib, p), {
    input: 500,
    output: 90,
    total: 590,
    reportedCalls: 3,
    cacheRate: 280 / 500,
    last: 350,
  });
});
test("missing provider cache fields are unknown, not zero; canceled unreported requests add no invented usage", () => {
  const p = {
    id: "p",
    worksheetResults: [{ status: "cancelled", attempts: [] }],
  };
  assert.equal(projectUsage({ tasks: [] }, p).cacheRate, null);
  const u = projectUsage(
    {
      tasks: [
        {
          projectId: "p",
          usage: [null, { prompt_tokens: 80, completion_tokens: 10 }],
        },
      ],
    },
    p,
  );
  assert.equal(u.total, 90);
  assert.equal(u.cacheRate, null);
  assert.equal(u.last, null);
});
