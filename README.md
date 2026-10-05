# link-preview-safe

```sh
npm install github:hon900/link-preview-safe#v0.5.0
```

Fetch HTML link metadata after a
[hostfence](https://github.com/hon900/hostfence) URL preflight check. Requests have a
deadline and a response byte limit, and never follow redirects. Requires Node.js
18.18 or later.

```js
import { preview, createPreview, PreviewError } from "link-preview-safe";

const card = await preview("https://example.com");
// { url, title, description, image }; absent metadata is null.

const partnerPreview = createPreview({
  policy: { protocols: ["https"], allowedHosts: ["docs.example.com"] },
  maxBytes: 512 * 1024,
  timeoutMs: 5_000,
});

const controller = new AbortController();
await partnerPreview("https://docs.example.com/guide", {
  headers: new Headers({ "accept-language": "en" }),
  signal: controller.signal,
});
```

## API and limits

`preview(url, init?)` uses the default policy. `createPreview(options?)` creates
the same function with a custom policy or resource limits. Fetch options support
ordinary header objects, `Headers`, and header tuples. An existing `Accept` value
is preserved; otherwise the request accepts HTML and XHTML. `redirect` is always
overridden to `error`.

| Option | Default | Behavior |
| --- | --- | --- |
| `policy` | hostfence defaults | Full policy passed to the URL validator |
| `maxBytes` | 1,048,576 | Cap on bytes read from the decoded response stream |
| `timeoutMs` | 10,000 | Deadline covering DNS preflight, Fetch, and body reads |

Both limits must be positive safe integers; `timeoutMs` cannot exceed
2,147,483,647. Oversized `Content-Length` is rejected early, and streamed bytes are
counted even when the header is absent or inaccurate. Discarded response bodies
are cancelled. An underlying custom DNS lookup may continue after the caller's
deadline, but its eventual result cannot initiate a request.

Only successful HTTP responses with `text/html` or `application/xhtml+xml` are
accepted. Missing or incompatible content types are rejected. These response
checks and resource limits tighten the older unbounded behavior.

## Metadata and errors

Open Graph title and description take precedence over `<title>` and ordinary
description metadata. Attribute order, quoted/unquoted attributes, common named
entities, and numeric entities are supported. The first value for each metadata
key wins. Extraction is best effort rather than a complete browser HTML parser;
the package does not execute JavaScript or fetch images.

The `image` field preserves the page's metadata value, including relative URLs.
All returned text and URLs are untrusted: escape text when rendering and validate
image URLs separately before any server-side fetch.

`HostfenceError` is re-exported for rejected destinations. `PreviewError` has a
stable `code`, and HTTP failures also expose `status`:

| Code | Meaning |
| --- | --- |
| `PREVIEW_TIMEOUT` | Preview deadline expired |
| `PREVIEW_TOO_LARGE` | Declared or streamed response exceeded the byte limit |
| `PREVIEW_HTTP_STATUS` | HTTP response was not successful |
| `PREVIEW_CONTENT_TYPE` | Response was not declared as HTML |

Caller aborts preserve the signal's reason. Native network and redirect errors
propagate from Fetch. TypeScript declarations are included.

## Security boundary and development

Hostfence checks DNS before Fetch, but does not pin the connection to the checked
address. DNS changes between validation and connection remain a
time-of-check/time-of-use risk. Pair this helper with restricted egress or a
transport that verifies the connected destination when processing hostile URLs.

```sh
npm install
npm test
```

Tests use stubbed Fetch and DNS and local streams, with no external requests.
This release pins `github:hon900/hostfence#v1.3.0`; a local sibling build can be
linked to validate local changes across the packages.
