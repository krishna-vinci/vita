import type { Bullet, CheckNote } from "@vita/shared";
import { Eye, EyeOff, GripVertical, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  onDragStart,
  onDropHere,
}: {
  bullet: Bullet;
  flag?: Flag;
  ctx: SheetContext;
  position: { itemId: string; index: number; count: number };
  onDragStart: (id: string) => void;
  onDropHere: (itemId: string, index: number) => void;
}) {
  const { actions, details, busy, changed, claims, checks } = ctx;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bullet.text);
  const [over, setOver] = useState(false);
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
      className={cn(
        "group/line relative -ml-6 flex list-none flex-col rounded-sm py-0.5 pl-6",
        changed.has(bullet.id) && "bg-primary/10",
        over && "outline-2 outline-primary/60 outline-dashed",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDropHere(position.itemId, position.index);
      }}
    >
      <div className="flex items-start gap-1">
        <span aria-hidden="true" className="absolute top-2.5 left-[18px] size-1 rounded-full bg-sheet-ink" />
        <div className="min-w-0 flex-1 pl-3 break-words">{body}</div>
        {!editing && (
          <div className="flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-focus-within/line:opacity-100 md:group-hover/line:opacity-100">
            <button
              type="button"
              draggable
              aria-label="Drag to reorder"
              title="Drag to reorder"
              className="hidden size-8 cursor-grab items-center justify-center rounded-md text-sheet-muted hover:bg-black/5 md:flex"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                onDragStart(bullet.id);
              }}
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
                  onSelect={() => actions.move(bullet.id, position.itemId, position.index - 1)}
                >
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={position.index >= position.count - 1}
                  onSelect={() => actions.move(bullet.id, position.itemId, position.index + 1)}
                >
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.hide(bullet.id, !bullet.hidden)}>
                  {bullet.hidden ? <Eye /> : <EyeOff />}
                  {bullet.hidden ? "Show this line" : "Hide this line"}
                </DropdownMenuItem>
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
