import type { HostfencePolicy } from "hostfence";

export { HostfenceError } from "hostfence";

export type PreviewErrorCode = "PREVIEW_TIMEOUT" | "PREVIEW_TOO_LARGE" | "PREVIEW_HTTP_STATUS" | "PREVIEW_CONTENT_TYPE";
export declare class PreviewError extends Error {
  readonly code: PreviewErrorCode;
  readonly status: number | undefined;
  constructor(message: string, code: PreviewErrorCode, status?: number);
}

export interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  /** Untrusted metadata; validate separately before any server-side image fetch. */
  image: string | null;
}

export interface PreviewOptions {
  policy?: HostfencePolicy;
  /** Maximum decoded response bytes. Default: 1,048,576. */
  maxBytes?: number;
  /** Deadline covering DNS, fetch, and body reads. Default: 10,000 ms. */
  timeoutMs?: number;
}

/** Redirects are always disabled, regardless of init.redirect. */
export type PreviewFetcher = (url: string | URL, init?: RequestInit) => Promise<Preview>;
export declare const preview: PreviewFetcher;
export declare function createPreview(options?: PreviewOptions): PreviewFetcher;
