import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DOTSBOOK_DB = join(mkdtempSync(join(tmpdir(), "dotsbook-")), "test.db");
process.env.PORT = "0"; // ephemeral port
// All these tests share one client IP (127.0.0.1), so the real per-IP register limit would be
// exhausted by unrelated tests partway through the file. Raise it here; the dedicated rate-limit
// tests below exercise the actual limiter logic directly instead of via shared HTTP state.
process.env.REGISTER_LIMIT_MAX = "1000";
process.env.POST_LIMIT_MAX = "1000";

const { server } = await import("../server/index.mjs");

let base;
before(async () => {
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const addr = server.address();
  base = `http://127.0.0.1:${addr.port}`;
});
after(() => {
  server.close();
  rmSync(process.env.DOTSBOOK_DB, { force: true });
});

function jpost(path, body, headers = {}) {
  return fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("health check", async () => {
  const res = await fetch(base + "/api/health");
  assert.equal(res.status, 200);
});

test("register an agent, get a usable key", async () => {
  const res = await jpost("/api/agents", { name: "TestBot", shape: 2, color: "#22c0f2" });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.name, "TestBot");
  assert.ok(body.apiKey.startsWith("dot_"));
});

test("duplicate name is rejected", async () => {
  await jpost("/api/agents", { name: "DupeBot", shape: 0, color: "#6b7bff" });
  const res2 = await jpost("/api/agents", { name: "DupeBot", shape: 1, color: "#ff9a76" });
  assert.equal(res2.status, 409);
});

test("invalid name/shape/color rejected", async () => {
  assert.equal((await jpost("/api/agents", { name: "x", shape: 0, color: "#6b7bff" })).status, 400); // too short
  assert.equal((await jpost("/api/agents", { name: "ValidName", shape: 99, color: "#6b7bff" })).status, 400); // bad shape
  assert.equal((await jpost("/api/agents", { name: "ValidName2", shape: 0, color: "#not-a-color" })).status, 400); // bad color
});

test("posting requires a valid key", async () => {
  const res = await jpost("/api/posts", { submolt: "d/errands", text: "hi" });
  assert.equal(res.status, 401);
  const res2 = await jpost("/api/posts", { submolt: "d/errands", text: "hi" }, { authorization: "Bearer dot_not-real" });
  assert.equal(res2.status, 401);
});

test("a registered agent can post, and it shows up in the feed", async () => {
  const reg = await (await jpost("/api/agents", { name: "Poster1", shape: 3, color: "#a6d02a" })).json();
  const post = await jpost("/api/posts", { submolt: "d/errands", text: "ran an errand" }, { authorization: `Bearer ${reg.apiKey}` });
  assert.equal(post.status, 201);
  const feed = await (await fetch(base + "/api/posts?submolt=d/errands")).json();
  assert.ok(feed.posts.some((p) => p.text === "ran an errand" && p.agent_name === "Poster1"));
});

test("unknown submolt rejected", async () => {
  const reg = await (await jpost("/api/agents", { name: "Poster2", shape: 0, color: "#6b7bff" })).json();
  const res = await jpost("/api/posts", { submolt: "d/not-real", text: "hi" }, { authorization: `Bearer ${reg.apiKey}` });
  assert.equal(res.status, 400);
});

test("text length is enforced", async () => {
  const reg = await (await jpost("/api/agents", { name: "Poster3", shape: 0, color: "#6b7bff" })).json();
  const tooLong = "a".repeat(501);
  const res = await jpost("/api/posts", { submolt: "d/errands", text: tooLong }, { authorization: `Bearer ${reg.apiKey}` });
  assert.equal(res.status, 400);
  const empty = await jpost("/api/posts", { submolt: "d/errands", text: "   " }, { authorization: `Bearer ${reg.apiKey}` });
  assert.equal(empty.status, 400);
});

test("the rate limiter itself blocks after max and recovers after the window", async () => {
  const { makeLimiter } = await import("../server/ratelimit.mjs");
  const check = makeLimiter({ max: 3, windowMs: 50 });
  assert.equal(check("k").allowed, true);
  assert.equal(check("k").allowed, true);
  assert.equal(check("k").allowed, true);
  const blocked = check("k");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(check("other-key").allowed, true); // separate key, separate bucket
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(check("k").allowed, true); // window elapsed, allowed again
});

test("post rate limit is enforced end to end at the configured threshold", async () => {
  // Exercise the real HTTP path with a dedicated low threshold via a second server instance,
  // so it doesn't compete with the shared-IP traffic the rest of this file generates.
  process.env.POST_LIMIT_MAX = "2";
  process.env.PORT = "0";
  const mod = await import(`../server/index.mjs?limited=${Date.now()}`);
  await new Promise((resolve, reject) => {
    if (mod.server.listening) return resolve();
    mod.server.once("listening", resolve);
    mod.server.once("error", reject);
  });
  const limitedBase = `http://127.0.0.1:${mod.server.address().port}`;
  const reg = await (await fetch(limitedBase + "/api/agents", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "RateLimited" + Date.now(), shape: 0, color: "#6b7bff" }),
  })).json();
  const headers = { "content-type": "application/json", authorization: `Bearer ${reg.apiKey}` };
  const post = (text) => fetch(limitedBase + "/api/posts", { method: "POST", headers, body: JSON.stringify({ submolt: "d/errands", text }) });
  assert.equal((await post("one")).status, 201);
  assert.equal((await post("two")).status, 201);
  const third = await post("three");
  assert.equal(third.status, 429);
  mod.server.close();
  process.env.POST_LIMIT_MAX = "1000";
});

test("path traversal on static files is blocked", async () => {
  const res = await fetch(base + "/../../etc/passwd");
  assert.notEqual(res.status, 200);
});

test("robots.txt and llms.txt are served", async () => {
  const r1 = await fetch(base + "/robots.txt");
  assert.equal(r1.status, 200);
  const r2 = await fetch(base + "/llms.txt");
  assert.equal(r2.status, 200);
});

test("a script-tag post is never returned as raw HTML for the client to inject unescaped", async () => {
  const reg = await (await jpost("/api/agents", { name: "XssTest", shape: 0, color: "#6b7bff" })).json();
  const payload = "<script>alert(1)</script>";
  await jpost("/api/posts", { submolt: "d/errands", text: payload }, { authorization: `Bearer ${reg.apiKey}` });
  const feed = await (await fetch(base + "/api/posts?submolt=d/errands")).json();
  const found = feed.posts.find((p) => p.agent_name === "XssTest");
  // The API stores/returns raw text (that's correct for a JSON API); the contract is that the
  // FRONTEND renders it via textContent, not innerHTML — see app.js. This test just pins the
  // stored value so a future change to escape-on-write would be caught, and documents the contract.
  assert.equal(found.text, payload);
});
