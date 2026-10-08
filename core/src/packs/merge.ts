import type { Pack } from "@vita/shared";

function unique<T>(entries: T[], key: (entry: T) => string): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const normalized = key(entry).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function mergePacks(parent: Pack, child: Pack): Pack {
  return {
    ...parent,
    ...child,
    keywords: unique(
      [...parent.keywords, ...child.keywords].map((group) => unique(group, (word) => word)),
      (group) => JSON.stringify(group.map((word) => word.toLowerCase())),
    ),
    metric_questions: unique([...parent.metric_questions, ...child.metric_questions], (entry) => entry),
    section_order: unique([...parent.section_order, ...child.section_order], (entry) => entry),
    verbs: unique([...parent.verbs, ...child.verbs], (entry) => entry),
    banned_phrases: unique([...parent.banned_phrases, ...child.banned_phrases], (entry) => entry),
    interview_topics: unique([...parent.interview_topics, ...child.interview_topics], (entry) => entry),
  };
}
