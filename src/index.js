import { Hostfence, HostfenceError } from "hostfence";

export { HostfenceError };

export class PreviewError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "PreviewError";
    this.code = code;
    this.status = status;
  }
}

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

function decodeText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, name) => {
    if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()];
    const hex = name[1].toLowerCase() === "x";
    const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : "\ufffd";
  }).trim();
}

function metadata(html) {
  const tags = new Map();
  // Ignore common places where markup is quoted rather than part of the page.
  const markup = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  for (const match of markup.matchAll(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = new Map();
    const content = match[0].slice(5, -1);
    for (const attribute of content.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = attribute[1].toLowerCase();
      if (!attributes.has(name)) {
        attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
      }
    }
    const key = (attributes.get("property") ?? attributes.get("name"))?.toLowerCase();
    const value = attributes.get("content");
    if (key && value !== undefined && !tags.has(key)) tags.set(key, decodeText(value));
  }
  return {
    title: tags.get("og:title") || decodeText(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "") || null,
    description: tags.get("og:description") || tags.get("description") || null,
    image: tags.get("og:image") || null,
  };
}

function cancelBody(body, reason) {
  if (body) void body.cancel(reason).catch(() => {});
}

async function readHtml(response, maxBytes, signal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  let complete = false;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        complete = true;
        return html + decoder.decode();
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new PreviewError(`Preview exceeds ${maxBytes} bytes`, "PREVIEW_TOO_LARGE");
      }
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function createPreview({ policy, maxBytes = 1_048_576, timeoutMs = 10_000 } = {}) {
  positiveInteger(maxBytes, "maxBytes");
  positiveInteger(timeoutMs, "timeoutMs");
  if (timeoutMs > 2_147_483_647) throw new TypeError("timeoutMs exceeds the timer limit");
  const fence = new Hostfence(policy);

  return async function previewWithPolicy(url, init = {}) {
    const options = { ...init };
    const headers = new Headers(options.headers);
    if (!headers.has("accept")) headers.set("accept", "text/html, application/xhtml+xml");
    const callerSignal = options.signal;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal.reason);
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    if (callerSignal?.aborted) onCallerAbort();
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => controller.abort(
      new PreviewError(`Preview timed out after ${timeoutMs} ms`, "PREVIEW_TIMEOUT"),
    ), timeoutMs);

    async function run() {
      controller.signal.throwIfAborted();
      const safe = await fence.assert(url);
      controller.signal.throwIfAborted();
      const response = await fetch(safe, { ...options, headers, redirect: "error", signal: controller.signal });
      if (controller.signal.aborted) {
        cancelBody(response.body, controller.signal.reason);
        controller.signal.throwIfAborted();
      }
      let error;
      if (!response.ok) {
        error = new PreviewError(`Preview returned HTTP ${response.status}`, "PREVIEW_HTTP_STATUS", response.status);
      } else {
        const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        if (type !== "text/html" && type !== "application/xhtml+xml") {
          error = new PreviewError("Preview requires an HTML content type", "PREVIEW_CONTENT_TYPE");
        } else {
          const length = response.headers.get("content-length");
          if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
            error = new PreviewError(`Preview exceeds ${maxBytes} bytes`, "PREVIEW_TOO_LARGE");
          }
        }
      }
      if (error) {
        cancelBody(response.body, error);
        throw error;
      }
      const html = await readHtml(response, maxBytes, controller.signal);
      return { url: safe.toString(), ...metadata(html) };
    }

    try {
      // The race also bounds DNS preflight and transports that ignore AbortSignal.
      return await Promise.race([run(), interrupted]);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      controller.signal.removeEventListener("abort", onAbort);
    }
  };
}

export const preview = createPreview();
