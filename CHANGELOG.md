# Changelog

## 0.5.0 — 2026-10-05

- Adopt hostfence 1.3.0 destination-policy hardening and standalone CI.
- Add `createPreview` with configurable hostfence policy, byte limit, and deadline.
- Bound DNS/fetch/body waits, preserve caller cancellation, and cancel discarded
  response streams.
- Require successful HTML responses and count streamed bytes independently of
  `Content-Length`.
- Preserve `Headers` and tuple inputs; recognize Open Graph title, attribute order,
  unquoted attributes, and common HTML entities.
- Add structured preview errors, TypeScript declarations, and offline regressions.
- Document untrusted metadata and the DNS preflight/connection boundary.
