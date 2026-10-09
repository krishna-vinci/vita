import type { Finding, Resume, Rules } from "@vita/shared";

const normalize = (title: string) => title.trim().toLowerCase();

function validPeriod(period: string, format: NonNullable<Rules["date_format"]>): boolean {
  const year = "(?:19|20)\\d{2}";
  const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  const date = format === "YYYY" ? year : format === "MM/YYYY" ? `(?:0[1-9]|1[0-2])/${year}` : `${month} ${year}`;
  return new RegExp(`^${date}(?:\\s*(?:[-–—]|to)\\s*(?:${date}|Present|Current))?$`, "i").test(period.trim());
}

export function lintExtraRules(resume: Resume, rules: Partial<Rules>): Finding[] {
  const findings: Finding[] = [];
  const sections = resume.sections.filter((section) => !section.hidden);
  for (const title of rules.required_sections ?? []) {
    if (!sections.some((section) => normalize(section.title) === normalize(title))) {
      findings.push({ rule: "required-section", severity: "block", message: `Missing section: ${title}.` });
    }
  }
  const order = (rules.section_order ?? []).map(normalize);
  const positions = sections.map((section) => order.indexOf(normalize(section.title))).filter((index) => index >= 0);
  if (positions.some((position, index) => index > 0 && position < (positions[index - 1] ?? 0))) {
    findings.push({ rule: "section-order", severity: "warn", message: "Sections differ from the configured order." });
  }
  if (rules.date_format) {
    for (const section of sections) {
      for (const item of section.items) {
        if (!item.hidden && item.period && !validPeriod(item.period, rules.date_format)) {
          findings.push({
            rule: "date-format",
            severity: "warn",
            message: `Item "${item.title}" period "${item.period}" must use ${rules.date_format}.`,
          });
        }
      }
    }
  }
  return findings;
}
