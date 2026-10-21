import { describe, expect, it } from "vitest";
import {
  AnswersRequest,
  AvailableModelsView,
  ChatReplyIds,
  ChatRequest,
  ChatThread,
  CreateApplicationRequest,
  ImportLegacyRequest,
  PutMarkdownRequest,
  PutSettingsRequest,
  ResumeOpsRequest,
  SourceApplyRequest,
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

it("exports per-resume instruction, archive and link contracts with strict limits", async () => {
  const {
    CreateBaseRequest,
    CreateApplicationRequest,
    PutResumeInstructionsRequest,
    RegenerateResumeRequest,
    ArchivedFilter,
    Item,
  } = await import("./index");
  expect(CreateBaseRequest.parse({ name: "Direction", instructions: "Brief" }).instructions).toBe("Brief");
  expect(CreateApplicationRequest.parse({ jobText: "Role", instructions: "Brief" }).instructions).toBe("Brief");
  expect(PutResumeInstructionsRequest.parse({ instructions: "" }).instructions).toBe("");
  expect(RegenerateResumeRequest.parse({})).toEqual({});
  expect(PutResumeInstructionsRequest.safeParse({ instructions: "x".repeat(20001) }).success).toBe(false);
  expect(RegenerateResumeRequest.safeParse({ instructions: "x".repeat(20001) }).success).toBe(false);
  expect(ArchivedFilter.safeParse("include").success).toBe(true);
  expect(ArchivedFilter.safeParse("only").success).toBe(true);
  expect(Item.parse({ id: "entry", title: "Entry", links: [] }).links).toEqual([]);
  expect(
    Item.safeParse({
      id: "entry",
      title: "Entry",
      links: Array(5).fill({ label: "Site", url: "https://example.test" }),
    }).success,
  ).toBe(false);
});

it("accepts saved chat IDs and validates thread message and text caps", () => {
  expect(ChatRequest.parse({ message: " Continue ", threadId: "thread-1" })).toEqual({
    message: "Continue",
    threadId: "thread-1",
  });
  expect(ChatRequest.safeParse({ message: "Continue", threadId: "../escape" }).success).toBe(false);
  const message = { id: "message-1", role: "assistant", text: "Saved answer", at: "2026-10-21T00:00:00.000Z" };
  const thread = {
    id: "thread-1",
    kind: "source",
    key: "outline-projects",
    title: "Question",
    createdAt: message.at,
    updatedAt: message.at,
    messages: Array.from({ length: 200 }, () => message),
  };
  expect(ChatThread.safeParse(thread).success).toBe(true);
  expect(ChatThread.safeParse({ ...thread, messages: [...thread.messages, message] }).success).toBe(false);
  expect(ChatThread.safeParse({ ...thread, messages: [{ ...message, text: "x".repeat(20_001) }] }).success).toBe(false);
  expect(ChatReplyIds.parse({ threadId: "thread-1", messageId: "message-1" })).toEqual({
    threadId: "thread-1",
    messageId: "message-1",
  });
  expect(
    SourceApplyRequest.safeParse({
      file: "outline",
      before: "Before",
      after: "After",
      summary: "Update",
      baseHash: "a".repeat(64),
      messageId: "message-1",
    }).success,
  ).toBe(true);
});
