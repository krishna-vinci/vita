import { Type } from "typebox";
import { type ToolDefinition, wrapUntrusted } from "../agent/index.js";

export const MAX_FETCH_BYTES = 200 * 1024;
export type WebFetch = typeof fetch;

function allowedUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Web fetch requires an HTTP(S) URL without credentials");
  url.hash = "";
  return url.href;
}

function extractText(text: string, html: boolean): string {
  if (!html) return text;
  return text
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (original, code: string) => {
      const point = code[0]?.toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : original;
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name] ?? "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchWebText(
  url: string,
  urls: string[],
  fetcher: WebFetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const allowed = new Set(urls.map(allowedUrl));
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = allowedUrl(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    combined.throwIfAborted();
    if (!allowed.has(current)) throw new Error("URL is not on the research allow-list");
    const response = await fetcher(current, { redirect: "manual", signal: combined });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect is missing a location");
      current = allowedUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Web fetch failed (${response.status})`);
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "text/plain";
    if (!(type.startsWith("text/") || ["application/json", "application/xhtml+xml"].includes(type))) {
      await response.body?.cancel();
      throw new Error("Web fetch supports text content only");
    }
    if (Number(response.headers.get("content-length")) > MAX_FETCH_BYTES) {
      await response.body?.cancel();
      throw new Error("Web fetch exceeds 200 KB");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          combined.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_FETCH_BYTES) throw new Error("Web fetch exceeds 200 KB");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return extractText(text, type.includes("html"));
  }
  throw new Error("Too many web redirects");
}

export function webFetchTool(urls: string[], fetcher?: WebFetch, now: () => Date = () => new Date()): ToolDefinition {
  return {
    name: "web_fetch",
    label: "Fetch research source",
    description: "Fetch one allow-listed URL as untrusted text, at most 200 KB. Redirects must also be allow-listed.",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, args, signal) {
      const { url } = args as { url: string };
      const text = await fetchWebText(url, urls, fetcher, signal);
      return {
        content: [{ type: "text", text: wrapUntrusted(`web ${url} fetched ${now().toISOString()}`, text) }],
        details: {},
      };
    },
  };
}
