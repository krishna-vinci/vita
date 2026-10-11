import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LetterParagraph as Paragraph } from "@vita/shared";
import { Eye, EyeOff, GripVertical, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LetterFlag } from "./letter-view";

export interface ParagraphActions {
  edit(id: string, text: string): Promise<boolean>;
  hide(id: string, hidden: boolean): void;
  move(id: string, index: number): void;
  ask(message: string): void;
}

export function LetterParagraph({
  paragraph,
  flag,
  index,
  count,
  changed,
  details,
  actions,
}: {
  paragraph: Paragraph;
  flag?: LetterFlag;
  index: number;
  count: number;
  changed: boolean;
  details: boolean;
  actions: ParagraphActions;
}) {
  const sortable = useSortable({ id: paragraph.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(paragraph.text);
  const [open, setOpen] = useState(false);
  const start = () => {
    setDraft(paragraph.text);
    setEditing(true);
  };
  const save = async () => {
    const text = draft.trim();
    if (!text || text === paragraph.text) return setEditing(false);
    if (await actions.edit(paragraph.id, text)) setEditing(false);
  };
  const text = paragraph.hidden ? (
    <span className="text-sheet-muted line-through decoration-sheet-muted/50">{paragraph.text}</span>
  ) : flag ? (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-sm bg-sheet-highlight px-0.5 text-left text-inherit underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Question about this paragraph"
        >
          {paragraph.text}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 font-sans text-sm" align="start">
        <div className="flex flex-col gap-3">
          <p className="font-display text-base font-medium">Can you stand behind this paragraph?</p>
          <p className="text-muted-foreground">{flag.reason}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              actions.ask(`Reword this paragraph so it says only what my notes support: "${paragraph.text}"`);
              setOpen(false);
            }}
          >
            Say it more carefully
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              actions.hide(paragraph.id, true);
              setOpen(false);
            }}
          >
            Remove paragraph
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  ) : (
    <button
      type="button"
      className="cursor-text rounded-sm text-left hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
      onClick={start}
      aria-label={`Edit: ${paragraph.text}`}
    >
      {paragraph.text}
    </button>
  );
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "flex flex-col rounded-sm py-1",
        changed && "bg-primary/10",
        sortable.isDragging && "z-10 opacity-40",
      )}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            aria-label="Edit this paragraph"
            className="min-h-32 border-primary/40 bg-white font-resume text-[16px] text-sheet-ink dark:bg-white"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="text-sheet-ink" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1 break-words whitespace-pre-line">{text}</div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              ref={sortable.setActivatorNodeRef}
              aria-label="Drag to reorder"
              title="Drag to reorder, or press space then use the arrow keys"
              className="flex size-9 touch-none cursor-grab items-center justify-center rounded-md text-sheet-muted hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-primary"
              {...sortable.attributes}
              {...sortable.listeners}
            >
              <GripVertical className="size-4" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-sheet-muted" aria-label="Paragraph options">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={start}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === 0} onSelect={() => actions.move(paragraph.id, index - 1)}>
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index >= count - 1} onSelect={() => actions.move(paragraph.id, index + 1)}>
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.hide(paragraph.id, !paragraph.hidden)}>
                  {paragraph.hidden ? <Eye /> : <EyeOff />}
                  {paragraph.hidden ? "Show this paragraph" : "Hide this paragraph"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {paragraph.hidden && <p className="font-sans text-xs text-sheet-muted">Hidden, so it is not in your PDF.</p>}
      {details && flag && (
        <p className="mt-1 ml-1 border-l-2 border-sheet-muted/30 pl-3 font-mono text-[11px] text-[#9a6410]">
          {flag.detail}
        </p>
      )}
    </div>
  );
}
