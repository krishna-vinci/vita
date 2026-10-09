import { z } from "zod";
import { SourceProposal } from "./api";
import { EvidenceKind } from "./evidence";
import { Slug } from "./ids";

const line = z
  .string()
  .trim()
  .min(1)
  .max(20_000)
  .refine((s) => !/[\r\n]/.test(s), "Expected one line");
export const ResearchRequest = z.strictObject({ target: line, itemSlug: Slug.optional() });
export type ResearchRequest = z.infer<typeof ResearchRequest>;
export const EvidenceSubmission = z.strictObject({
  item: z.strictObject({
    name: line,
    slug: Slug.optional(),
    kind: line,
    links: z.array(z.url()).max(100),
    stack: z.array(line).max(100),
    period: line.optional(),
  }),
  claims: z
    .array(
      z.strictObject({
        text: line,
        evidence: z
          .array(z.strictObject({ kind: EvidenceKind, ref: line, text: line.optional() }))
          .min(1)
          .max(100),
      }),
    )
    .max(100),
  limits: z.array(line).max(100),
  variants: z.array(z.strictObject({ label: line, text: line })).max(100),
  notes: z.array(line).max(100),
});
export type EvidenceSubmission = z.infer<typeof EvidenceSubmission>;
export const ResearchReply = z.object({ reply: z.string(), proposal: SourceProposal.nullable() });
export type ResearchReply = z.infer<typeof ResearchReply>;

const exposure = z.enum(["codemode", "codemode-deferred", "deferred", "direct", "hidden"]);
const common = {
  enabled: z.boolean().optional(),
  exposure: exposure.optional(),
  toolExposure: z.record(z.string(), exposure).optional(),
  description: z.string().optional(),
  timeout: z.number().positive().optional(),
};
const oauth = z.strictObject({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  callbackPort: z.number().int().min(1).max(65535).optional(),
  callbackUrl: z.url().optional(),
  scope: z.string().optional(),
  clientName: z.string().optional(),
  clientRegistration: z.enum(["dcr", "cimd"]).optional(),
  authServerMetadataUrl: z.url().optional(),
});
export const McpConfig = z
  .strictObject({
    mcpServers: z
      .record(
        z.string().regex(/^[a-zA-Z0-9_-]+$/),
        z.union([
          z.strictObject({
            ...common,
            type: z.literal("stdio").optional(),
            command: z.string().min(1),
            args: z.array(z.string()).optional(),
            env: z.record(z.string(), z.string()).optional(),
            cwd: z.string().optional(),
          }),
          z.strictObject({
            ...common,
            type: z.enum(["http", "streamable-http"]).optional(),
            url: z.url(),
            headers: z.record(z.string(), z.string()).optional(),
            oauth: oauth.optional(),
            auth: z.strictObject({ provider: z.string().min(1) }).optional(),
          }),
        ]),
      )
      .default({}),
    autoEnableCodemode: z.boolean().optional(),
  })
  .superRefine((config, ctx) => {
    const names = new Set<string>();
    for (const name of Object.keys(config.mcpServers)) {
      const normalized = name.replaceAll("-", "_");
      if (names.has(normalized))
        ctx.addIssue({ code: "custom", message: "MCP server namespaces must be unique", path: ["mcpServers", name] });
      names.add(normalized);
    }
  });
export type McpConfig = z.infer<typeof McpConfig>;
