import { type Item, type Resume, type Section, slugify } from "@vita/shared";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Flag } from "@/lib/resume-view";
import { cn } from "@/lib/utils";
import { BulletLine } from "./BulletLine";
import type { SheetContext } from "./types";

/** The resume as HTML, mirroring the PDF's structure. Every line renders as text. */
export function ResumeSheet({
  resume,
  flags,
  ctx,
}: {
  resume: Resume;
  flags: ReadonlyMap<string, Flag>;
  ctx: SheetContext;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const contact = resume.header.contact.map((entry) => entry.value).filter(Boolean);
  const onDropHere = (itemId: string, index: number) => {
    if (dragId) ctx.actions.move(dragId, itemId, index);
    setDragId(null);
  };
  return (
    <article
      aria-label="Your resume"
      className="mx-auto flex w-full max-w-[720px] flex-col gap-2 rounded-sm bg-sheet px-5 py-7 font-resume text-[16px] leading-snug text-sheet-ink shadow-[0_1px_3px_rgba(0,0,0,.12),0_6px_20px_rgba(0,0,0,.06)] sm:px-10 sm:py-9"
    >
      <h2 className="text-center text-[26px] leading-none font-semibold">{resume.header.name}</h2>
      {resume.header.headline && <p className="text-center text-sheet-muted">{resume.header.headline}</p>}
      {contact.length > 0 && <p className="text-center text-sm break-words text-sheet-muted">{contact.join(" · ")}</p>}
      {resume.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          flags={flags}
          ctx={ctx}
          onDragStart={setDragId}
          onDropHere={onDropHere}
        />
      ))}
    </article>
  );
}

function SectionView({
  section,
  flags,
  ctx,
  onDragStart,
  onDropHere,
}: {
  section: Section;
  flags: ReadonlyMap<string, Flag>;
  ctx: SheetContext;
  onDragStart: (id: string) => void;
  onDropHere: (itemId: string, index: number) => void;
}) {
  return (
    <section aria-label={section.title} className={cn("mt-2 flex flex-col gap-1.5", section.hidden && "opacity-60")}>
      <div className="flex items-center justify-between border-b border-sheet-ink">
        <h3 className="text-[13px] font-semibold tracking-wider uppercase">{section.title}</h3>
        <Button
          variant="ghost"
          size="xs"
          className="font-sans text-sheet-muted"
          onClick={() => ctx.actions.hideSection(section.id, !section.hidden)}
          disabled={ctx.busy}
        >
          {section.hidden ? <Eye /> : <EyeOff />}
          {section.hidden ? "Show section" : "Hide section"}
        </Button>
      </div>
      {section.hidden ? (
        <p className="font-sans text-xs text-sheet-muted">Hidden, so it is not in your PDF.</p>
      ) : (
        <>
          {section.text && <p className="break-words whitespace-pre-line">{section.text}</p>}
          {section.items.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              flags={flags}
              ctx={ctx}
              onDragStart={onDragStart}
              onDropHere={onDropHere}
            />
          ))}
        </>
      )}
    </section>
  );
}

function ItemView({
  item,
  flags,
  ctx,
  onDragStart,
  onDropHere,
}: {
  item: Item;
  flags: ReadonlyMap<string, Flag>;
  ctx: SheetContext;
  onDragStart: (id: string) => void;
  onDropHere: (itemId: string, index: number) => void;
}) {
  const heading = [item.title, item.subtitle].filter(Boolean).join(", ");
  const when = [item.period, item.location].filter(Boolean).join(" · ");
  return (
    <div className={cn("flex flex-col gap-1", item.hidden && "opacity-60")}>
      {(heading || when) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 font-semibold">
          <span className="break-words">{heading}</span>
          <span className="flex items-center gap-2">
            {when}
            {item.hidden && (
              <Button
                variant="ghost"
                size="xs"
                className="font-sans font-normal text-sheet-muted"
                onClick={() => ctx.actions.hideItem(item.id, false)}
              >
                <Eye /> Show
              </Button>
            )}
          </span>
        </div>
      )}
      {!item.hidden && (
        <ul className="m-0 flex flex-col gap-1 pl-4">
          {item.bullets.map((bullet, index) => (
            <BulletLine
              key={bullet.id}
              bullet={bullet}
              flag={flags.get(bullet.id)}
              ctx={ctx}
              position={{
                itemId: item.id,
                itemSlug: item.source ?? slugify(item.title),
                index,
                count: item.bullets.length,
              }}
              onDragStart={onDragStart}
              onDropHere={onDropHere}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
