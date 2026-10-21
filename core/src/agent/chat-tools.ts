import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { type ChatChange, type ChatTurn, HttpUrl, PutProfileRequest } from "@vita/shared";
import { Type } from "typebox";
import { parse } from "yaml";
import { z } from "zod";
import type { Context } from "../pipeline/context.js";
import { loadContext } from "../pipeline/context.js";
import type { PipelineDeps } from "../pipeline/types.js";
import { recordStatement, setProfile, setProjectLinks } from "../source/chat-edits.js";
import { parseProjects } from "../source/projects.js";
import { readText } from "../workspace/index.js";
import type { RoleToolContext } from "./tools.js";
import { wrapUntrusted } from "./untrusted.js";

export interface StatementConversation {
  message: string;
  history: ChatTurn[];
  threadId?: string;
  /** Server-supplied full saved user history, separate from the ten-turn model window. */
  statementMessages?: string[];
}

export function chatTools(ctx: Context, input: StatementConversation, deps: PipelineDeps, tools: RoleToolContext) {
  const threadId = input.threadId ?? randomUUID();
  const changes: ChatChange[] = [];
  const shas: (string | null)[] = [];
  const refresh = async () => {
    const updated = await loadContext(ctx.ws);
    for (const key of ["claims", "items", "variants"] as const) {
      ctx.index[key].clear();
      for (const [id, value] of updated.index[key]) (ctx.index[key] as Map<string, unknown>).set(id, value);
    }
    ctx.search.close();
    ctx.search = updated.search;
    tools.search = ctx.search;
  };
  function tool<T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    action: (value: z.infer<T>) => Promise<{ sha: string | null }>,
  ) {
    return defineTool({
      name,
      label: name,
      description,
      parameters: Type.Unsafe<z.infer<T>>(z.toJSONSchema(schema, { io: "input" })),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const result = await action(schema.parse(params));
        shas.push(result.sha);
        await refresh();
        return { content: [{ type: "text" as const, text: wrapUntrusted(name, JSON.stringify(result)) }], details: {} };
      },
    });
  }
  const customTools = [
    tool(
      "set_project_links",
      "Add or remove project metadata links immediately, without evidence. Use only known http(s) URLs; read sources first if the URL is absent from the message.",
      z.strictObject({
        itemSlug: z.string().min(1),
        add: z.array(HttpUrl).optional(),
        remove: z.array(HttpUrl).optional(),
      }),
      async (value) => {
        const before =
          parseProjects(await readText(ctx.ws.root, "projects.md")).doc.items.find(
            (item) => item.slug === value.itemSlug,
          )?.meta.links ?? [];
        const result = await setProjectLinks(ctx.ws.root, value);
        if (JSON.stringify(before) !== JSON.stringify(result.links))
          changes.push({ kind: "field", id: value.itemSlug, field: "links", before, after: result.links });
        return result;
      },
    ),
    tool(
      "set_profile",
      "Update the profile headline, location or contacts immediately. Metadata needs no evidence.",
      z.strictObject({
        headline: PutProfileRequest.shape.profile.shape.headline,
        location: PutProfileRequest.shape.profile.shape.location,
        contact: PutProfileRequest.shape.profile.shape.contact.removeDefault().optional(),
      }),
      async (value) => {
        const before = parse(await readText(ctx.ws.root, "profile.yaml")) ?? {};
        const result = await setProfile(ctx.ws.root, value);
        const after = parse(await readText(ctx.ws.root, "profile.yaml")) ?? {};
        for (const field of ["headline", "location", "contact"] as const)
          if (JSON.stringify(before[field]) !== JSON.stringify(after[field]))
            changes.push({
              kind: "field",
              id: "profile",
              field,
              before: before[field] ?? null,
              after: after[field] ?? null,
            });
        return result;
      },
    ),
  ];
  if (ctx.rules.honesty !== "strict")
    customTools.push(
      tool(
        "record_statement",
        "Record an actual statement from the person's messages as dated evidence ('you said') and return its claimId for immediate use in a bullet. Never invent or expand the quote.",
        z.strictObject({
          itemSlug: z.string().min(1),
          quote: z.string().min(1).max(20_000),
          claimText: z.string().min(1).max(20_000),
        }),
        (value) =>
          recordStatement(ctx.ws.root, value, {
            messages: [
              ...(input.statementMessages ??
                input.history.filter((turn) => turn.role === "user").map((turn) => turn.text)),
              input.message,
            ],
            threadId,
            now: deps.now?.() ?? new Date(),
          }),
      ),
    );
  return { customTools, shas, changes };
}
