import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Bullet, CheckNote } from "@vita/shared";
import { Eye, EyeOff, GripVertical, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { type Flag, splitAround } from "@/lib/resume-view";
import { cn } from "@/lib/utils";
import { FlagPopover } from "./FlagPopover";
import type { SheetContext } from "./types";

const textButton =
  "cursor-text rounded-sm text-left align-baseline hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary";

export function BulletLine({
  bullet,
  flag,
  ctx,
  position,
  inline = false,
}: {
  bullet: Bullet;
  flag?: Flag;
  ctx: SheetContext;
  position: { itemId: string; itemSlug: string; index: number; count: number };
  /** Sits in a run of lines, separated by commas, as a titled list item does. */
  inline?: boolean;
}) {
  const { actions, details, busy, changed, claims, checks } = ctx;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bullet.text);
  const sortable = useSortable({ id: bullet.id });
  const start = () => {
    setDraft(bullet.text);
    setEditing(true);
  };
  const save = async () => {
    const text = draft.trim();
    if (!text || text === bullet.text) return setEditing(false);
    if (await actions.edit(bullet.id, text)) setEditing(false);
  };
  const split = flag?.kind === "number" ? splitAround(bullet.text, flag.raw) : null;
  const mark = (
    <button
      type="button"
      className="rounded-sm bg-sheet-highlight px-0.5 text-left text-inherit underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
      aria-label={flag?.kind === "number" ? `Question about ${flag.raw}` : "Question about this line"}
    >
      {split ? split[1] : bullet.text}
    </button>
  );
  const body = editing ? (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        value={draft}
        aria-label="Edit this line"
        className="min-h-20 border-primary/40 bg-white font-resume text-[15px] text-sheet-ink dark:bg-white"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" className="text-sheet-ink" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <span className="self-center font-sans text-xs text-sheet-muted">Enter saves, Esc cancels</span>
      </div>
    </div>
  ) : bullet.hidden ? (
    <span className="text-sheet-muted line-through decoration-sheet-muted/50">{bullet.text}</span>
  ) : split && flag ? (
    <>
      <button type="button" className={textButton} onClick={start}>
        {split[0]}
      </button>
      <FlagPopover flag={flag} bulletId={bullet.id} text={bullet.text} actions={actions}>
        {mark}
      </FlagPopover>
      <button type="button" className={textButton} onClick={start}>
        {split[2]}
      </button>
    </>
  ) : flag ? (
    <FlagPopover flag={flag} bulletId={bullet.id} text={bullet.text} actions={actions}>
      {mark}
    </FlagPopover>
  ) : (
    <button type="button" className={textButton} onClick={start} aria-label={`Edit: ${bullet.text}`}>
      {bullet.text}
    </button>
  );
  const sources = bullet.claims.map((id) => ({ id, claim: claims.get(id) }));
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        inline
          ? "group/line relative inline-flex list-none items-start rounded-sm after:content-[','] last:after:content-none"
          : "group/line relative -ml-6 flex list-none flex-col rounded-sm py-0.5 pl-6",
        changed.has(bullet.id) && "bg-primary/10",
        sortable.isDragging && "z-10 opacity-40",
      )}
    >
      <div className="flex items-start gap-1">
        {!inline && (
          <span aria-hidden="true" className="absolute top-2.5 left-[18px] size-1 rounded-full bg-sheet-ink" />
        )}
        <div className={cn("min-w-0 flex-1 break-words", !inline && "pl-3")}>{body}</div>
        {!editing && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              ref={sortable.setActivatorNodeRef}
              aria-label="Drag to reorder"
              title="Drag to reorder, or press space then use the arrow keys"
              className="flex size-9 touch-none cursor-grab items-center justify-center rounded-md text-sheet-muted hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"
              {...sortable.attributes}
              {...sortable.listeners}
            >
              <GripVertical className="size-4" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-sheet-muted" aria-label="Line options">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={start}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={position.index === 0}
                  onSelect={() => void actions.move(bullet.id, position.itemId, position.index - 1)}
                >
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={position.index >= position.count - 1}
                  onSelect={() => void actions.move(bullet.id, position.itemId, position.index + 1)}
                >
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.hide(bullet.id, !bullet.hidden)}>
                  {bullet.hidden ? <Eye /> : <EyeOff />}
                  {bullet.hidden ? "Show this line" : "Hide this line"}
                </DropdownMenuItem>
                {actions.promote && !bullet.hidden && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!ctx.canPromoteParent}
                      onSelect={() => actions.promote?.(bullet.id, "parent", position.itemSlug)}
                    >
                      Use this wording in my base resume
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => actions.promote?.(bullet.id, "variant", position.itemSlug)}>
                      Save as a wording option in Projects
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {bullet.hidden && !editing && (
        <p className="pl-3 font-sans text-xs text-sheet-muted">Hidden, so it is not in your PDF.</p>
      )}
      {details && <LineDetails bullet={bullet} flag={flag} sources={sources} note={checks.get(bullet.id)} />}
    </li>
  );
}

function LineDetails({
  bullet,
  flag,
  sources,
  note,
}: {
  note?: CheckNote;
  bullet: Bullet;
  flag?: Flag;
  sources: { id: string; claim?: { text: string; evidence: { id: string; text: string }[] } }[];
}) {
  return (
    <div className="mt-1 ml-3 flex flex-col gap-0.5 border-l-2 border-sheet-muted/30 pl-3 font-mono text-[11px] leading-snug text-sheet-muted">
      {bullet.origin === "user" || bullet.locked ? (
        <span>Written or edited by you, so the AI will not change it.</span>
      ) : null}
      {sources.length ? (
        sources.map(({ id, claim }) => (
          <span key={id}>
            Based on: {claim ? claim.text : `a note of yours (${id})`}
            {claim?.evidence.map((ev) => (ev.text ? ` · evidence: ${ev.text}` : ` · evidence ${ev.id}`))}
          </span>
        ))
      ) : (
        <span>No source recorded for this line.</span>
      )}
      {note && (
        <span>
          Checked: {note.verdict}, {note.reason}
        </span>
      )}
      {bullet.override && (
        <span className="text-[#9a6410]">
          You vouched for this{bullet.override.note ? `: ${bullet.override.note}` : "."}
        </span>
      )}
      {flag && <span className="text-[#9a6410]">{flag.detail}</span>}
    </div>
  );
}
