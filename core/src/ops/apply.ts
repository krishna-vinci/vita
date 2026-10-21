import { type Bullet, type Item, Resume, type Section, slugify } from "@vita/shared";
import { resolveLayout } from "../render/templates.js";
import { type OpContext, OpError, type ResumeOp, ResumeOpSchema } from "./types.js";

type Node =
  | { kind: "section"; value: Section; siblings: Section[] }
  | { kind: "item"; value: Item; siblings: Item[] }
  | { kind: "bullet"; value: Bullet; siblings: Bullet[] };

function find(resume: Resume, id: string): Node {
  for (const section of resume.sections) {
    if (section.id === id) return { kind: "section", value: section, siblings: resume.sections };
    for (const item of section.items) {
      if (item.id === id) return { kind: "item", value: item, siblings: section.items };
      const bullet = item.bullets.find((entry) => entry.id === id);
      if (bullet) return { kind: "bullet", value: bullet, siblings: item.bullets };
    }
  }
  throw new OpError("unknown-id", `Unknown resume id: ${id}`);
}

function bulletAt(resume: Resume, id: string): Bullet {
  const node = find(resume, id);
  if (node.kind !== "bullet") throw new OpError("invalid", `Expected a bullet: ${id}`);
  return node.value;
}

function itemAt(resume: Resume, id: string): Item {
  const node = find(resume, id);
  if (node.kind !== "item") throw new OpError("invalid", `Expected an item: ${id}`);
  return node.value;
}

function sectionAt(resume: Resume, id: string): Section {
  const node = find(resume, id);
  if (node.kind !== "section") throw new OpError("invalid", `Expected a section: ${id}`);
  return node.value;
}

function bulletsIn(node: Node): Bullet[] {
  if (node.kind === "bullet") return [node.value];
  if (node.kind === "item") return node.value.bullets;
  return node.value.items.flatMap((item) => item.bullets);
}

function protect(bullets: Bullet[], ctx: OpContext): void {
  if (ctx.by !== "ai") return;
  const locked = bullets.find((bullet) => bullet.locked);
  if (locked) throw new OpError("locked", `Bullet is locked: ${locked.id}`);
}

function userEdit(bullet: Bullet, ctx: OpContext): void {
  if (ctx.by === "user") {
    bullet.origin = "user";
    bullet.locked = true;
  }
}

function checkIndex(index: number, length: number): void {
  if (index > length) throw new OpError("invalid", `Index ${index} exceeds destination length ${length}`);
}

function nextId(resume: Resume, text: string): string {
  const ids = new Set<string>();
  for (const section of resume.sections) {
    ids.add(section.id);
    for (const item of section.items) {
      ids.add(item.id);
      for (const bullet of item.bullets) ids.add(bullet.id);
    }
  }
  const prefix = `b-${slugify(text)}`;
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function move<T extends { id: string }>(value: T, source: T[], destination: T[], index: number): void {
  // The index refers to the final destination, after removing the moving node.
  checkIndex(index, destination.length - (source === destination ? 1 : 0));
  source.splice(source.indexOf(value), 1);
  destination.splice(index, 0, value);
}

export function applyOps(
  resume: Resume,
  ops: ResumeOp[],
  ctx: OpContext,
): { resume: Resume; changedBullets: string[] } {
  const parsed = Resume.safeParse(resume);
  if (!parsed.success) throw new OpError("invalid", `Invalid resume: ${parsed.error.message}`);
  const batch = ResumeOpSchema.array().safeParse(ops);
  if (!batch.success) throw new OpError("invalid", `Invalid operations: ${batch.error.message}`);
  // All semantic validation and mutations happen on this isolated draft; failures never expose it.
  const draft = parsed.data;
  const changed = new Set<string>();
  for (const op of batch.data) {
    switch (op.op) {
      case "bullet.edit":
      case "bullet.hide":
      case "bullet.lock":
      case "bullet.override":
      case "variant.swap": {
        const bullet = bulletAt(draft, op.op === "variant.swap" ? op.bulletId : op.id);
        protect([bullet], ctx);
        switch (op.op) {
          case "bullet.edit":
            bullet.text = op.text;
            break;
          case "bullet.hide":
            bullet.hidden = op.hidden;
            break;
          case "bullet.lock":
            break;
          case "bullet.override":
            bullet.override = { reason: op.reason, at: ctx.now(), ...(op.note === undefined ? {} : { note: op.note }) };
            break;
          case "variant.swap": {
            const variant = ctx.index.variants.get(op.variantId);
            if (!variant) throw new OpError("unknown-id", `Unknown variant: ${op.variantId}`);
            bullet.text = variant.text;
            bullet.variantOf = variant.id;
            break;
          }
        }
        userEdit(bullet, ctx);
        // Explicit unlock must remain possible for a user.
        if (op.op === "bullet.lock") bullet.locked = op.locked;
        changed.add(bullet.id);
        break;
      }
      case "bullet.add": {
        const item = itemAt(draft, op.itemId);
        const index = op.index ?? item.bullets.length;
        checkIndex(index, item.bullets.length);
        const claim = op.claimId === undefined ? undefined : ctx.index.claims.get(op.claimId);
        const variant = op.variantId === undefined ? undefined : ctx.index.variants.get(op.variantId);
        if (op.claimId !== undefined && !claim) throw new OpError("unknown-id", `Unknown claim: ${op.claimId}`);
        if (op.variantId !== undefined && !variant) throw new OpError("unknown-id", `Unknown variant: ${op.variantId}`);
        if (op.claimIds !== undefined) {
          if (op.text === undefined) throw new OpError("invalid", "claimIds requires text");
          for (const id of op.claimIds)
            if (!ctx.index.claims.has(id)) throw new OpError("unknown-id", `Unknown claim: ${id}`);
        }
        const text = op.claimIds === undefined ? (variant?.text ?? claim?.text ?? op.text) : op.text;
        if (text === undefined) throw new OpError("invalid", "A new bullet needs text, a claim or a variant");
        const bullet: Bullet = {
          id: nextId(draft, text),
          text,
          claims:
            op.claimIds === undefined
              ? claim
                ? [claim.id]
                : []
              : [...new Set([...op.claimIds, ...(claim ? [claim.id] : [])])],
          origin: ctx.by,
          locked: ctx.by === "user",
          ...(variant ? { variantOf: variant.id } : {}),
        };
        item.bullets.splice(index, 0, bullet);
        changed.add(bullet.id);
        break;
      }
      case "section.add":
        draft.sections.push({ id: op.id, title: op.title, kind: op.kind, items: [] });
        break;
      case "item.add":
        sectionAt(draft, op.sectionId).items.push({
          id: op.id,
          title: op.title,
          bullets: [],
          ...(op.source === undefined ? {} : { source: op.source }),
        });
        break;
      case "move": {
        const node = find(draft, op.id);
        const bullets = bulletsIn(node);
        protect(bullets, ctx);
        switch (node.kind) {
          case "bullet":
            move(node.value, node.siblings, itemAt(draft, op.toParent).bullets, op.index);
            break;
          case "item":
            move(node.value, node.siblings, sectionAt(draft, op.toParent).items, op.index);
            break;
          case "section":
            if (op.toParent !== "root") throw new OpError("invalid", "Sections can only move to root");
            move(node.value, node.siblings, draft.sections, op.index);
            break;
        }
        for (const bullet of bullets) {
          userEdit(bullet, ctx);
          changed.add(bullet.id);
        }
        break;
      }
      case "section.rename":
        sectionAt(draft, op.id).title = op.title;
        break;
      case "item.hide":
      case "section.hide": {
        const node = find(draft, op.id);
        const expected = op.op === "item.hide" ? "item" : "section";
        if (node.kind !== expected) throw new OpError("invalid", `Expected a ${expected}: ${op.id}`);
        const bullets = bulletsIn(node);
        protect(bullets, ctx);
        node.value.hidden = op.hidden;
        for (const bullet of bullets) {
          userEdit(bullet, ctx);
          changed.add(bullet.id);
        }
        break;
      }
      case "layout.set": {
        // Section order is not a template knob: every template honours it (render/tex.ts orderedSections).
        if (op.key === "section_order") {
          if (!Array.isArray(op.value)) throw new OpError("invalid", "section_order must be a list of section ids");
          const known = new Set(draft.sections.map((section) => section.id));
          draft.layout = {
            ...draft.layout,
            section_order: [...new Set(op.value.filter((sectionId) => known.has(sectionId)))],
          };
          break;
        }
        if (Array.isArray(op.value)) throw new OpError("invalid", `Layout key ${op.key} takes a single value`);
        if (!Object.hasOwn(ctx.template.knobs, op.key)) throw new OpError("invalid", `Unknown layout key: ${op.key}`);
        let value: number | string | boolean | string[] | undefined;
        try {
          value = resolveLayout(ctx.template, { [op.key]: op.value })[op.key];
        } catch (error) {
          throw new OpError("invalid", error instanceof Error ? error.message : String(error));
        }
        if (value === undefined || Array.isArray(value))
          throw new OpError("invalid", `Unresolved layout key: ${op.key}`);
        draft.layout = { ...draft.layout, [op.key]: value };
        break;
      }
    }
  }
  const result = Resume.safeParse(draft);
  if (!result.success) throw new OpError("invalid", `Invalid resulting resume: ${result.error.message}`);
  return { resume: result.data, changedBullets: [...changed] };
}
