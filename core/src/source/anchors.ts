import { ClaimId, EvidenceId } from "@vita/shared";

export interface Anchor {
  claim?: string;
  evidence: string[];
  variant?: string;
}

export function readAnchor(line: string): { text: string; anchor: Anchor | null } {
  const match = /<!--\s*([^<>]*?)\s*-->\s*$/.exec(line);
  if (!match) return { text: line.trimEnd(), anchor: null };
  const anchor: Anchor = { evidence: [] };
  const seen = new Set<string>();
  for (const token of (match[1] ?? "").trim().split(/\s+/)) {
    const field = /^(c|ev|v):(.+)$/.exec(token);
    if (!field || seen.has(field[1] ?? "")) return { text: line.trimEnd(), anchor: null };
    const [, key, value = ""] = field;
    seen.add(key ?? "");
    if (key === "ev") {
      const ids = value.split(",");
      if (!ids.every((id) => EvidenceId.safeParse(id).success)) return { text: line.trimEnd(), anchor: null };
      anchor.evidence = ids;
    } else {
      if (!ClaimId.safeParse(value).success) return { text: line.trimEnd(), anchor: null };
      if (key === "c") anchor.claim = value;
      else anchor.variant = value;
    }
  }
  return { text: line.slice(0, match.index).trimEnd(), anchor };
}

export function writeAnchor(text: string, anchor: Anchor): string {
  const fields: string[] = [];
  if (anchor.claim) fields.push(`c:${anchor.claim}`);
  if (anchor.evidence.length) fields.push(`ev:${anchor.evidence.join(",")}`);
  if (anchor.variant) fields.push(`v:${anchor.variant}`);
  return fields.length ? `${text.trimEnd()} <!-- ${fields.join(" ")} -->` : text;
}
