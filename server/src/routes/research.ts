import {
  applySourceEdit,
  fileHash,
  GitHubError,
  loadProfile,
  ProfileRequiredError,
  parseProjects,
  profileGitHubLogin,
  readMcpConfig,
  readText,
  redactMcpConfig,
  relationshipProposal,
  researchItem,
  suggestOwnership,
  writeMcpConfig,
} from "@vita/core";
import { McpConfig, OwnershipQuery, PutRelationshipRequest, ResearchRequest, Slug, slugify } from "@vita/shared";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
  return schema.parse(input);
}

export function researchRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.get("/research/ownership", async (c) => {
    const { repo } = OwnershipQuery.parse({ repo: c.req.query("repo") });
    try {
      const token = runtime.options.githubToken?.() ?? process.env.GITHUB_TOKEN;
      let userLogin: string | undefined;
      if (!token) {
        try {
          userLogin = profileGitHubLogin(await loadProfile(runtime.ws.root));
        } catch (error) {
          if (!(error instanceof ProfileRequiredError)) throw error;
        }
      }
      return c.json(
        await suggestOwnership(repo, {
          token,
          userLogin,
          fetch: runtime.options.researchFetch,
        }),
      );
    } catch (error) {
      if (error instanceof GitHubError) throw new ApiFailure(422, "github-unavailable", error.message);
      throw error;
    }
  });
  app.put("/projects/:slug/relationship", async (c) => {
    const slug = Slug.parse(c.req.param("slug"));
    const input = await body(c, PutRelationshipRequest);
    return runtime.exclusive(async () => {
      const hash = await fileHash(runtime.ws.root, "projects.md");
      if (!hash) throw new ApiFailure(404, "not-found", "Projects inventory not found");
      const markdown = await readText(runtime.ws.root, "projects.md");
      if (!parseProjects(markdown).doc.items.some((item) => item.slug === slug))
        throw new ApiFailure(404, "not-found", `Project not found: ${slug}`);
      const proposal = relationshipProposal(markdown, hash, slug, input);
      const { sha } = await applySourceEdit(runtime.ws, proposal);
      runtime.changed("projects", sha);
      return c.json({ ...(await runtime.markdown("projects.md")), sha });
    });
  });
  app.post("/research", async (c) => {
    const input = await body(c, ResearchRequest);
    const resourceId = input.itemSlug ?? slugify(input.target);
    const job = runtime.jobs.enqueue("research", resourceId, (ctx) =>
      runtime.exclusive(async () => {
        const result = await researchItem(runtime.ws, input, await runtime.researchDeps(ctx));
        return { scope: "research", id: resourceId, sha: null, ...result };
      }),
    );
    return c.json({ job, sha: null }, 202);
  });
  app.get("/settings/mcp", async (c) => c.json(redactMcpConfig(await readMcpConfig(runtime.ws.root))));
  app.put("/settings/mcp", async (c) => {
    const input = await body(c, McpConfig);
    return runtime.exclusive(async () => {
      const config = await writeMcpConfig(runtime.ws.root, input);
      runtime.changed("settings", null);
      return c.json(config);
    });
  });
  return app;
}
