import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreview, preview, PreviewError, HostfenceError } from "../src/index.js";

const publicUrl = "https://1.1.1.1/article";
const htmlResponse = (html, init = {}) => new Response(html, {
  ...init, headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
});

test("extracts Open Graph metadata regardless of attribute order and quote style", async (t) => {
  t.mock.method(globalThis, "fetch", async () => htmlResponse(`
    <title>Fallback</title>
    <!-- <meta property="og:title" content="Comment"> -->
    <script>const sample = '<meta property="og:title" content="Script">';</script>
    <META CONTENT='Fish &amp; Chips &#x1f41f;' PROPERTY='og:title'>
    <meta name=description content="Fallback description">
    <meta content="An &quot;example&quot; > ordinary" property="og:description">
    <meta content='/cover.jpg' property='og:image'>
    <meta property="og:title" content="Later duplicate">
  `));
  assert.deepEqual(await preview(publicUrl), {
    url: publicUrl, title: "Fish & Chips 🐟", description: 'An "example" > ordinary', image: "/cover.jpg",
  });
});

test("falls back to title and description and returns null for absent fields", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => htmlResponse("<title> Title &amp; More </title><meta name=description content='Summary'>"));
  assert.deepEqual(await preview(publicUrl), { url: publicUrl, title: "Title & More", description: "Summary", image: null });
  fetch.mock.mockImplementation(async () => htmlResponse("<html></html>"));
  assert.deepEqual(await preview(publicUrl), { url: publicUrl, title: null, description: null, image: null });
});

test("preserves Headers and tuple inputs while disabling redirects", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (_, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.get("x-preview"), "yes");
    assert.equal(init.headers.get("accept"), "application/xhtml+xml");
    return htmlResponse("<title>ok</title>");
  });
  for (const headers of [new Headers({ "x-preview": "yes", accept: "application/xhtml+xml" }), [["x-preview", "yes"], ["Accept", "application/xhtml+xml"]]]) {
    await preview(publicUrl, { headers, redirect: "follow" });
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("checks a custom policy before fetching", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected fetch"); });
  await assert.rejects(preview("http://169.254.169.254/"), HostfenceError);
  const configured = createPreview({ policy: { lookup: async () => ["1.1.1.1", "127.0.0.1"] } });
  await assert.rejects(configured("https://mixed.example/"), HostfenceError);
  assert.equal(fetch.mock.callCount(), 0);
});

test("rejects HTTP failures, redirects, and non-HTML responses and cancels their bodies", async (t) => {
  let cancelled = 0;
  const scenarios = [
    { status: 503, headers: { "content-type": "text/html" }, code: "PREVIEW_HTTP_STATUS" },
    { status: 302, headers: { location: "http://127.0.0.1/" }, code: "PREVIEW_HTTP_STATUS" },
    { status: 200, headers: { "content-type": "application/json" }, code: "PREVIEW_CONTENT_TYPE" },
    { status: 200, headers: {}, code: "PREVIEW_CONTENT_TYPE" },
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => {});
  for (const scenario of scenarios) {
    fetch.mock.mockImplementation(async () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }), scenario));
    await assert.rejects(preview(publicUrl), (error) => {
      assert.ok(error instanceof PreviewError);
      assert.equal(error.code, scenario.code);
      if (scenario.status !== 200) assert.equal(error.status, scenario.status);
      return true;
    });
  }
  assert.equal(cancelled, scenarios.length);
});

test("rejects an oversized Content-Length before reading", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => htmlResponse(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { "content-length": "4096" },
  }));
  await assert.rejects(createPreview({ maxBytes: 20 })(publicUrl), { code: "PREVIEW_TOO_LARGE" });
  assert.equal(cancelled, true);
});

test("caps streamed bytes even when Content-Length understates the body", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => htmlResponse(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("가나다")); },
    cancel() { cancelled = true; },
  }), { headers: { "content-length": "1" } }));
  await assert.rejects(createPreview({ maxBytes: 8 })(publicUrl), { code: "PREVIEW_TOO_LARGE" });
  assert.equal(cancelled, true);
});

test("decodes UTF-8 across chunk boundaries", async (t) => {
  const bytes = new TextEncoder().encode("<title>한글</title>");
  t.mock.method(globalThis, "fetch", async () => htmlResponse(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 8));
      controller.enqueue(bytes.slice(8));
      controller.close();
    },
  })));
  assert.equal((await createPreview({ maxBytes: bytes.length })(publicUrl)).title, "한글");
});

test("times out a stalled response body and cancels the stream", { timeout: 2000 }, async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => htmlResponse(new ReadableStream({ cancel() { cancelled = true; } })));
  await assert.rejects(createPreview({ timeoutMs: 20 })(publicUrl), { code: "PREVIEW_TIMEOUT" });
  assert.equal(cancelled, true);
});

test("times out DNS preflight and does not fetch if DNS completes later", { timeout: 2000 }, async (t) => {
  let resolveLookup;
  const configured = createPreview({ timeoutMs: 20, policy: { lookup: () => new Promise((resolve) => { resolveLookup = resolve; }) } });
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected fetch"); });
  await assert.rejects(configured("https://slow.example/"), { code: "PREVIEW_TIMEOUT" });
  resolveLookup(["1.1.1.1"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetch.mock.callCount(), 0);
});

test("preserves caller abort reasons before and during fetch", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  const reason = new Error("caller stopped preview");
  const fetch = t.mock.method(globalThis, "fetch", async (_, init) => {
    controller.abort(reason);
    assert.equal(init.signal.aborted, true);
    return new Promise(() => {});
  });
  await assert.rejects(preview(publicUrl, { signal: controller.signal }), (error) => error === reason);
  await assert.rejects(preview(publicUrl, { signal: controller.signal }), (error) => error === reason);
  assert.equal(fetch.mock.callCount(), 1);
});

test("rejects invalid resource limits", () => {
  for (const maxBytes of [0, -1, 1.5, Infinity]) assert.throws(() => createPreview({ maxBytes }), TypeError);
  for (const timeoutMs of [0, -1, 2 ** 31]) assert.throws(() => createPreview({ timeoutMs }), TypeError);
});
