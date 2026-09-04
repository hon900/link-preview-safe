import { Hostfence, HostfenceError } from "hostfence";

const fence = new Hostfence();

export { HostfenceError };

function pickMeta(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(re)?.[1] ?? null;
}

export async function preview(url, init = {}) {
  const safe = await fence.assert(url);
  const res = await fetch(safe, {
    ...init,
    redirect: "error",
    headers: { accept: "text/html", ...(init.headers ?? {}) },
  });
  const html = await res.text();
  return {
    url: safe.toString(),
    title: html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null,
    description: pickMeta(html, "og:description") ?? pickMeta(html, "description"),
    image: pickMeta(html, "og:image"),
  };
}
