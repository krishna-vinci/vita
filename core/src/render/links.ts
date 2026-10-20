import { type Item, type ItemLink, type Resume, safeHref, urlValue } from "@vita/shared";
import { parseOutline } from "../source/outline.js";
import { parseProjects } from "../source/projects.js";
import { readText } from "../workspace/index.js";

export { contactView, safeHref } from "@vita/shared";

export interface RenderSources {
  projects?: string;
  outline?: string;
}
export async function loadRenderSources(root: string): Promise<RenderSources> {
  const optional = async (rel: string) => {
    try {
      return await readText(root, rel);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return "";
    }
  };
  const [projects, outline] = await Promise.all([optional("projects.md"), optional("outline.md")]);
  return { projects, outline };
}

function evidenceItems(sources: RenderSources) {
  const items = parseProjects(sources.projects ?? "").doc.items;
  // Outline entries can carry the same fenced YAML metadata without changing the source parser contract.
  for (const section of parseOutline(sources.outline ?? "").sections) {
    for (const entry of section.entries) {
      const parsed = parseProjects(`## ${entry.title}\n${entry.body.join("\n")}`).doc.items[0];
      if (parsed) {
        parsed.claims = entry.bullets.flatMap((bullet) =>
          bullet.claimId ? [{ id: bullet.claimId, text: bullet.text, evidence: [], metrics: [] }] : [],
        );
        items.push(parsed);
      }
    }
  }
  return items;
}

function derivedLinks(urls: string[]): ItemLink[] {
  let website: ItemLink | undefined;
  let repository: ItemLink | undefined;
  const hosts: Record<string, string> = {
    "github.com": "GitHub",
    "gitlab.com": "GitLab",
    "bitbucket.org": "Bitbucket",
    "codeberg.org": "Codeberg",
    "git.sr.ht": "SourceHut",
  };
  for (const value of urls) {
    if (!/^https?:\/\//i.test(value) || !safeHref(value)) continue;
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const hostLabels: Record<string, string> = {
      gitlab: "GitLab",
      gitea: "Gitea",
      forgejo: "Forgejo",
      git: "Repository",
    };
    const codeHost = hosts[host] ?? hostLabels[host.split(".")[0] ?? ""];
    const parts = url.pathname.split("/").filter(Boolean);
    if (codeHost) {
      if (parts.length !== 2 || url.search || url.hash) continue;
      repository ??= { label: codeHost, url: value };
    } else website ??= { label: "Website", url: value };
  }
  return [website, repository].filter((link): link is ItemLink => link !== undefined);
}

/** Resolve links at render time; never persist derived metadata into the resume. */
export function linkedResume(resume: Resume, sources: RenderSources = {}): Resume {
  const evidence = evidenceItems(sources);
  const links = (item: Item): ItemLink[] => {
    if (item.links !== undefined) return item.links.filter((link) => safeHref(link.url));
    const source = item.source?.replace(/^(?:projects|outline)(?:\.md)?[#:/]/, "");
    let owner = evidence.find((entry) => entry.slug === source) ?? evidence.find((entry) => entry.slug === item.id);
    if (!owner) {
      const claims = new Set(item.bullets.flatMap((bullet) => bullet.claims));
      const ranked = evidence.map((entry) => ({
        entry,
        count: [...entry.claims, ...entry.variants].filter((claim) => claims.has(claim.id)).length,
      }));
      ranked.sort((a, b) => b.count - a.count);
      if (ranked[0]?.count) owner = ranked[0].entry;
    }
    return derivedLinks(owner?.meta.links ?? []);
  };
  // A subtitle or location that is only a URL already shown as a link would print twice.
  const linkKey = (value: string) => {
    const url = urlValue(value.trim());
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      return `${parsed.hostname.replace(/^www\./i, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
    } catch {
      return undefined;
    }
  };
  return {
    ...resume,
    sections: resume.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const itemLinks = links(item);
        const shown = new Set(itemLinks.map((link) => linkKey(link.url)));
        const duplicate = (value?: string) => value !== undefined && shown.has(linkKey(value));
        return {
          ...item,
          links: itemLinks,
          subtitle: duplicate(item.subtitle) ? undefined : item.subtitle,
          location: duplicate(item.location) ? undefined : item.location,
        };
      }),
    })),
  };
}
