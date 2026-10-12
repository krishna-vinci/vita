import { describe, expect, it } from "vitest";
import {
  AnswersRequest,
  AvailableModelsView,
  ChatRequest,
  CreateApplicationRequest,
  ImportLegacyRequest,
  PutMarkdownRequest,
  PutSettingsRequest,
  ResumeOpsRequest,
  SourceProposal,
  UndoRequest,
} from "./api";

describe("API contracts", () => {
  it("validates available model IDs and setup hints without credential values", () => {
    expect(
      AvailableModelsView.parse({ models: [{ id: "local/model", provider: "local", name: "Model" }], setupHints: [] })
        .models[0]?.id,
    ).toBe("local/model");
    expect(
      AvailableModelsView.safeParse({ models: [{ id: "invalid", provider: "local", name: "Model" }], setupHints: [] })
        .success,
    ).toBe(false);
    expect(AvailableModelsView.parse({ models: [], setupHints: ["Run `pnpm vita login`."] }).setupHints).toHaveLength(
      1,
    );
  });
  it("validates chat bodies, editor model settings, and exact source proposals", () => {
    expect(ChatRequest.safeParse({ message: " " }).success).toBe(false);
    expect(ChatRequest.safeParse({ message: "Edit", history: [] }).success).toBe(false);
    expect(
      SourceProposal.safeParse({
        file: "outline",
        before: "",
        after: "Text",
        summary: "Edit",
        baseHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      SourceProposal.safeParse({
        file: "../escape",
        before: "Text",
        after: "Text",
        summary: "Edit",
        baseHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      PutSettingsRequest.parse({
        template: "rover-base",
        models: { default: "faux/default", roles: { "resume-editor": "faux/resume", "source-editor": "faux/source" } },
      }).models.roles["source-editor"],
    ).toBe("faux/source");
  });
  it("requires concurrency hashes for source writes and applied imports", () => {
    expect(PutMarkdownRequest.safeParse({ markdown: "Text" }).success).toBe(false);
    expect(PutMarkdownRequest.parse({ markdown: "Text", baseHash: null }).baseHash).toBeNull();
    expect(ImportLegacyRequest.parse({ markdown: "Text" }).apply).toBe(false);
    expect(ImportLegacyRequest.safeParse({ markdown: "Text", apply: true }).success).toBe(false);
    expect(ImportLegacyRequest.parse({ markdown: "Text", apply: true, baseHash: "hash" }).apply).toBe(true);
  });
  it("validates operations and requires ids for scoped undo", () => {
    expect(
      ResumeOpsRequest.parse({ ops: [{ op: "bullet.override", id: "bullet", reason: "this-resume-only" }] }).ops[0]?.op,
    ).toBe("bullet.override");
    expect(
      ResumeOpsRequest.safeParse({ ops: [{ op: "move", id: "bullet", toParent: "item", index: -1 }] }).success,
    ).toBe(false);
    const sourceOps = [
      { op: "section.add", id: "source", title: "Source", kind: "entries" },
      { op: "item.add", sectionId: "source", id: "item", title: "Item", source: "item" },
      { op: "bullet.add", itemId: "item", text: "Combined wording", claimIds: ["claim-a", "claim-b"] },
    ];
    expect(ResumeOpsRequest.parse({ ops: sourceOps }).ops).toEqual(sourceOps);
    expect(UndoRequest.safeParse({ scope: "resume" }).success).toBe(false);
    expect(UndoRequest.parse({ scope: "outline" }).scope).toBe("outline");
    expect(UndoRequest.safeParse({ scope: "application", id: "../escape" }).success).toBe(false);
  });
  it("accepts free-text gap answers and rejects credentials in settings", () => {
    expect(AnswersRequest.parse({ answers: { req: "yes", other: "I have documentation" } }).answers.req).toBe("yes");
    expect(CreateApplicationRequest.safeParse({ jobText: " " }).success).toBe(false);
    expect(
      PutSettingsRequest.safeParse({
        template: "rover-base",
        models: { default: "faux/writer", apiKey: "not-accepted" },
      }).success,
    ).toBe(false);
  });
});
