import type { Contact } from "./resume";

/** Only these URI schemes may reach a document's link target. */
export function safeHref(value: string): string | undefined {
  if ([...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127))
    return undefined;
  try {
    const url = new URL(value);
    if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return value;
  } catch {}
  return undefined;
}

// Profiles often store links without a scheme ("github.com/user", "www.example.org").
const BARE_URL = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

export function urlValue(value: string): string | undefined {
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.includes("@") && BARE_URL.test(value)) return `https://${value}`;
  return undefined;
}

export function contactView(contact: Contact) {
  const value = contact.value;
  const url = urlValue(value);
  let target = contact.url;
  if (target === undefined) {
    if (url) target = url;
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) target = `mailto:${value}`;
    else if (/^\+?[\d(][\d\s().-]{4,}\d$/.test(value)) target = `tel:${value.replace(/[\s().-]/g, "")}`;
  }
  let display = value;
  if (url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./i, "");
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (host === "github.com" && parts.length === 1) display = parts[0] ?? value;
      else if (host === "linkedin.com" && parts[0] === "in" && parts.length === 2) display = parts[1] ?? value;
      else display = `${host}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {}
  }
  return { ...contact, href: target === undefined ? undefined : safeHref(target), display };
}
