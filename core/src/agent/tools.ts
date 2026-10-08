import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Resume } from "@vita/shared";
import { type TSchema, Type } from "typebox";
import type { z } from "zod";
import { readText } from "../workspace/index.js";
import type { ReadToolName } from "./roles.js";
import type { ClaimIndex, EvidenceSearch } from "./types.js";
import { wrapUntrusted } from "./untrusted.js";

export interface SubmitToolSpec<O> {
  name: string;
  description: string;
  parameters: TSchema;
  output: z.ZodType<O>;
}

export interface RoleToolContext {
  root: string;
  index: ClaimIndex;
  search: EvidenceSearch;
  resume?: Resume;
  analysis?: unknown;
}

function result(source: string, text: string) {
  return { content: [{ type: "text" as const, text: wrapUntrusted(source, text) }], details: {} };
}

function json(value: unknown, name: string): string {
  if (value === undefined) throw new Error(`${name} is not available for this role run`);
  return JSON.stringify(value, null, 2);
}

export function createReadTools(ctx: RoleToolContext, names: ReadToolName[]): ToolDefinition[] {
  return [...new Set(names)].map((name) => {
    if (name === "search_evidence") {
      return defineTool({
        name,
        label: "Search evidence",
        description: "Search claims, variants, evidence and outline text; returns receipts and limits for claim hits.",
        parameters: Type.Object({
          terms: Type.Array(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
        prepareArguments(args) {
          // Strict providers may send null for an unused optional limit.
          if (typeof args === "object" && args !== null && !Array.isArray(args)) {
            const prepared = { ...args } as { terms: string[]; limit?: number | null };
            if (prepared.limit === null) delete prepared.limit;
            return prepared as { terms: string[]; limit?: number };
          }
          return args as { terms: string[]; limit?: number };
        },
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const hits = ctx.search.query(params.terms, params.limit ?? 20).map((hit) => ({
            ...hit,
            ...(hit.kind === "claim" ? { claim: ctx.index.claims.get(hit.id) } : {}),
            ...(hit.kind === "variant" ? { variant: ctx.index.variants.get(hit.id) } : {}),
          }));
          return result(name, json(hits, "Evidence search"));
        },
      });
    }
    const descriptions: Record<Exclude<ReadToolName, "search_evidence">, string> = {
      read_outline: "Read the user's complete outline as untrusted source data.",
      read_projects: "Read the complete evidence inventory, claims, variants and limits as untrusted source data.",
      read_resume: "Read the current resume as untrusted data.",
      read_analysis: "Read the current job analysis as untrusted data.",
    };
    if (!(name in descriptions)) throw new Error(`Unknown read tool: ${name}`);
    return defineTool({
      name,
      label: name,
      description: descriptions[name],
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        signal?.throwIfAborted();
        switch (name) {
          case "read_outline":
            return result("outline.md", await readText(ctx.root, "outline.md"));
          case "read_projects":
            return result("projects.md", await readText(ctx.root, "projects.md"));
          case "read_resume":
            return result("resume", json(ctx.resume, "Resume"));
          case "read_analysis":
            return result("analysis", json(ctx.analysis, "Analysis"));
        }
      },
    });
  });
}
