import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { type Bullet, contactView, type Item, type Resume, type Section, slugify } from "@vita/shared";
import { Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Flag } from "@/lib/resume-view";
import { cn } from "@/lib/utils";
import { BulletLine } from "./BulletLine";
import type { SheetContext } from "./types";

type Order = Record<string, string[]>;

/** Bullet ids per item, in document order. */
function orderOf(resume: Resume): Order {
  const order: Order = {};
  for (const section of resume.sections)
    for (const item of section.items) order[item.id] = item.bullets.map((bullet) => bullet.id);
  return order;
}

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
  const server = useMemo(() => orderOf(resume), [resume]);
  // While dragging, and until the server confirms a move, the order shown is local. A failed move drops it.
  const [local, setLocal] = useState<Order | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const order = local ?? server;
  const bullets = useMemo(() => {
    const map = new Map<string, Bullet>();
    for (const section of resume.sections)
      for (const item of section.items) for (const bullet of item.bullets) map.set(bullet.id, bullet);
    return map;
  }, [resume]);
  const sectionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of resume.sections) for (const item of section.items) map.set(item.id, section.id);
    return map;
  }, [resume]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press-and-hold, so scrolling a phone still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerOf = (id: string, from: Order) =>
    id in from ? id : Object.keys(from).find((key) => from[key]?.includes(id));

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const current = local ?? server;
    const from = containerOf(String(active.id), current);
    const to = containerOf(String(over.id), current);
    if (!from || !to || from === to || sectionOf.get(from) !== sectionOf.get(to)) return;
    const target = current[to] ?? [];
    const overIndex = target.indexOf(String(over.id));
    const index = overIndex < 0 ? target.length : overIndex;
    setLocal({
      ...current,
      [from]: (current[from] ?? []).filter((id) => id !== String(active.id)),
      [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
    });
  };
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const id = String(active.id);
    let next = local ?? server;
    const container = containerOf(id, next);
    if (over && container) {
      const overId = String(over.id);
      const overContainer = containerOf(overId, next);
      if (overContainer === container && overId !== id) {
        const list = next[container] ?? [];
        next = { ...next, [container]: arrayMove(list, list.indexOf(id), Math.max(list.indexOf(overId), 0)) };
      }
    }
    const to = containerOf(id, next);
    const index = to ? (next[to] ?? []).indexOf(id) : -1;
    if (!to || index < 0 || JSON.stringify(next) === JSON.stringify(server)) return setLocal(null);
    setLocal(next);
    const ok = await ctx.actions.move(id, to, index);
    // On success the refreshed resume carries the new order; on failure the old order comes back.
    void ok;
    setLocal(null);
  };
  const contact = resume.header.contact.filter((entry) => entry.value).map(contactView);
  const active = activeId ? bullets.get(activeId) : undefined;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={(event) => void onDragEnd(event)}
      onDragCancel={() => {
        setActiveId(null);
        setLocal(null);
      }}
    >
      <article
        aria-label="Your resume"
        className="mx-auto flex w-full max-w-[720px] flex-col gap-2 rounded-sm bg-sheet px-5 py-7 font-resume text-[16px] leading-snug text-sheet-ink shadow-[0_1px_3px_rgba(0,0,0,.12),0_6px_20px_rgba(0,0,0,.06)] sm:px-10 sm:py-9"
      >
        <h2 className="text-center text-[26px] leading-none font-semibold">{resume.header.name}</h2>
        {resume.header.headline && <p className="text-center text-sheet-muted">{resume.header.headline}</p>}
        {contact.length > 0 && (
          <p className="text-center text-sm break-words text-sheet-muted">
            {contact.map((entry, index) => (
              <span key={`${entry.label}-${entry.value}`}>
                {index > 0 && " · "}
                {entry.href ? (
                  <a href={entry.href} target="_blank" rel="noreferrer" className="hover:underline">
                    {entry.display}
                  </a>
                ) : (
                  entry.display
                )}
              </span>
            ))}
          </p>
        )}
        {resume.sections.map((section) => (
          <SectionView key={section.id} section={section} flags={flags} ctx={ctx} order={order} bullets={bullets} />
        ))}
      </article>
      <DragOverlay>
        {active ? (
          <div className="rounded-md border bg-sheet px-3 py-2 font-resume text-[16px] text-sheet-ink shadow-lg">
            {active.text}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SectionView({
  section,
  flags,
  ctx,
  order,
  bullets,
}: {
  section: Section;
  flags: ReadonlyMap<string, Flag>;
  ctx: SheetContext;
  order: Order;
  bullets: ReadonlyMap<string, Bullet>;
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
            <ItemView key={item.id} item={item} flags={flags} ctx={ctx} ids={order[item.id] ?? []} bullets={bullets} />
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
  ids,
  bullets,
}: {
  item: Item;
  flags: ReadonlyMap<string, Flag>;
  ctx: SheetContext;
  ids: string[];
  bullets: ReadonlyMap<string, Bullet>;
}) {
  const heading = [item.title, item.subtitle].filter(Boolean).join(", ");
  const when = [item.period, item.location].filter(Boolean).join(" · ");
  // The list itself accepts drops, so a line can be dragged into an item that has no lines yet.
  const { setNodeRef } = useDroppable({ id: item.id });
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
      {!item.hidden && item.links && item.links.length > 0 && (
        <ul aria-label="Links" className="m-0 flex list-none flex-wrap gap-1.5 p-0 font-sans">
          {item.links.map((link) => (
            <li key={`${link.label}:${link.url}`}>
              <a
                href={/^https?:\/\//i.test(link.url) ? link.url : undefined}
                target="_blank"
                rel="noreferrer noopener"
                title={link.url}
                className="inline-flex max-w-full items-center rounded-full border border-sheet-muted/40 px-2 py-0.5 text-xs font-normal break-all text-sheet-muted hover:text-sheet-ink"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!item.hidden && (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul ref={setNodeRef} className="m-0 flex min-h-3 flex-col gap-1 pl-4">
            {ids.map((id, index) => {
              const bullet = bullets.get(id);
              return bullet ? (
                <BulletLine
                  key={id}
                  bullet={bullet}
                  flag={flags.get(id)}
                  ctx={ctx}
                  position={{ itemId: item.id, itemSlug: item.source ?? slugify(item.title), index, count: ids.length }}
                />
              ) : null;
            })}
          </ul>
        </SortableContext>
      )}
    </div>
  );
}
