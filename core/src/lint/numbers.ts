export interface NumberToken {
  raw: string;
  norm: string;
  index: number;
}

// Only explicit version shapes are exempt. A name followed by a decimal still
// needs support from a claim, metric or linked evidence.
const versions =
  /(?<![\p{L}\p{N}_.])(?:[vV]\d+(?:\.\d+)*|\p{L}+\d+(?:\.\d+)*|\d+(?:\.\d+){2,})(?![\p{L}\p{N}_]|\.\d)/gu;
const numbers =
  /[$€£₹]?[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[kMB](?![\p{L}\p{N}_]))?(?:[ \t]*(?:percent\b|%|[x×](?![\p{L}\p{N}_])))?/giu;

export function normalizeNumber(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/,/g, "")
    .replace(/[ \t]+/g, "");
  const match = /^([$€£₹]?)([+-]?)(\d+(?:\.\d+)?|\.\d+)([kmb]?)(%|percent|x|×)?$/i.exec(cleaned);
  if (!match) return cleaned;
  const [, currency = "", sign = "", amount = "", scale = "", unit = ""] = match;
  const [integer = "", fraction = ""] = amount.split(".");
  const shift = { k: 3, m: 6, b: 9 }[scale.toLowerCase()] ?? 0;
  // Move the decimal point as text so currency and large counts stay exact.
  const digits = integer + fraction;
  const point = integer.length + shift;
  const whole =
    (digits.slice(0, point) + "0".repeat(Math.max(0, point - digits.length))).replace(/^0+(?=\d)/, "") || "0";
  const decimals = digits.slice(point).replace(/0+$/, "");
  const value = whole + (decimals ? `.${decimals}` : "");
  const suffix = /^(%|percent)$/i.test(unit) ? "%" : unit ? "x" : "";
  return `${currency}${sign === "-" && value !== "0" ? "-" : ""}${value}${suffix}`;
}

export function extractNumbers(text: string): NumberToken[] {
  const ignored = [...text.matchAll(versions)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const tokens: NumberToken[] = [];
  for (const match of text.matchAll(numbers)) {
    let raw = match[0];
    let index = match.index;
    // A range separator belongs to neither endpoint, whereas a leading sign does.
    if (/^[+-]/.test(raw) && index > 0 && /[\p{L}\p{N}_%×]/u.test(text[index - 1] ?? "")) {
      raw = raw.slice(1);
      index++;
    }
    if (ignored.some((range) => index >= range.start && index + raw.length <= range.end)) continue;
    if (
      /^\d{4}$/.test(raw) &&
      Number(raw) >= 1950 &&
      Number(raw) <= 2099 &&
      !/[\p{L}\p{N}_]/u.test(text[index - 1] ?? "") &&
      !/[\p{L}\p{N}_]/u.test(text[index + raw.length] ?? "")
    ) {
      continue;
    }
    tokens.push({ raw, norm: normalizeNumber(raw), index });
  }
  return tokens;
}
