import type { CheckNote, ItemLink } from "@vita/shared";
import type { SourceClaim } from "@/lib/resume-view";

/** Everything a line of the resume can ask the page to do. */
export interface SheetActions {
  edit(id: string, text: string): Promise<boolean>;
  hide(id: string, hidden: boolean): void;
  lock(id: string, locked: boolean): void;
  /** The workspace's undo, which restores the previous version of the whole resume. */
  undo(): void;
  hideSection(id: string, hidden: boolean): void;
  hideItem(id: string, hidden: boolean): void;
  move(id: string, toParent: string, index: number): Promise<boolean>;
  vouch(id: string, note: string): void;
  ask(message: string): void;
  /** Only for job resumes. */
  promote?(bulletId: string, to: "parent" | "variant", itemSlug: string): void;
}

export interface SheetContext {
  actions: SheetActions;
  details: boolean;
  busy: boolean;
  canPromoteParent?: boolean;
  changed: ReadonlySet<string>;
  claims: ReadonlyMap<string, SourceClaim>;
  checks: ReadonlyMap<string, CheckNote>;
  /** Lint's "your estimate" messages per line, for numbers backed only by what the person said. */
  estimates: ReadonlyMap<string, string>;
  /** Links per item id as the PDF shows them. */
  links?: Readonly<Record<string, ItemLink[]>>;
}
