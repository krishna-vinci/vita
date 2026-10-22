import type { InfoView } from "@vita/shared";
import { Plus, Sparkles, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInfo } from "@/api/queries";
import { LeaveGuard } from "@/components/LeaveGuard";
import { PageError } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { readDraft, writeDraft } from "@/lib/use-draft";
import { useUrlParam } from "@/lib/use-url-state";
import { CertificationCard, EducationCard, ProjectCard, RoleCard } from "./EntryCards";
import { InfoProvider, useInfoMutate } from "./info-context";
import { fieldId, type MissingItem, missingItems, missingText } from "./info-model";
import { AboutCard, SummaryCard } from "./TopCards";

type Adding = "role" | "project" | "education" | "certification" | null;
interface Focus {
  card: string;
  id: string;
  token: number;
}
const hintsKey = "info:hints-dismissed";
const maxHints = 6;

/** The outline sections the form does not edit, one line each. */
function otherSections(items: InfoView["other"]) {
  const groups = new Map<string, string[]>();
  for (const { section, title } of items) {
    const list = groups.get(section) ?? [];
    const text = title.replace(/^[-*]\s+/, "").trim();
    if (text && text !== section && !list.includes(text)) list.push(text);
    groups.set(section, list);
  }
  return [...groups].map(([section, titles]) => ({ section, titles }));
}

function InfoSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex max-w-3xl flex-col gap-6">
      <span className="sr-only">Loading…</span>
      {[40, 28, 52, 36].map((height) => (
        <div key={height} className="flex flex-col gap-3 rounded-xl border p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="w-full" style={{ height }} />
        </div>
      ))}
    </div>
  );
}

export default function InfoTab() {
  const query = useInfo();
  if (query.isPending) return <InfoSkeleton />;
  if (query.isError) return <PageError error={query.error} retry={() => void query.refetch()} />;
  return <InfoPage view={query.data} />;
}

function InfoPage({ view }: { view: InfoView }) {
  const mutate = useInfoMutate();
  const [dirtyCards, setDirtyCards] = useState<ReadonlySet<string>>(new Set());
  const reportDirty = useCallback((card: string, dirty: boolean) => {
    setDirtyCards((current) => {
      if (current.has(card) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(card);
      else next.delete(card);
      return next;
    });
  }, []);
  const context = useMemo(() => ({ view, mutate, reportDirty }), [view, mutate, reportDirty]);

  // One card is open at a time, kept in the URL so a reload stays where you were.
  const [open, setOpen] = useUrlParam<string>("open", "");
  const [adding, setAdding] = useState<Adding>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [hintsHidden, setHintsHidden] = useState(() => readDraft(hintsKey) === "1");
  const toggle = (card: string) => setOpen(open === card ? "" : card);
  const cardProps = (card: string) => ({
    open: open === card,
    onToggle: () => toggle(card),
    focusField: focus?.card === card ? focus : null,
    onMoved: (next: string) => setOpen(next),
  });
  const jump = (item: MissingItem) => {
    setAdding(null);
    setOpen(item.card);
    setFocus({ card: item.card, id: fieldId(item.card, item.field), token: Date.now() });
  };
  const add = (kind: Exclude<Adding, null>) => {
    setOpen("");
    setAdding(kind);
  };
  const addCard = (kind: Exclude<Adding, null>) =>
    adding === kind
      ? {
          open: true,
          onToggle: () => setAdding(null),
          onCreated: () => setAdding(null),
        }
      : null;

  if (!view.hash.outline)
    return (
      <Empty className="min-h-64 max-w-3xl border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Sparkles />
          </EmptyMedia>
          <EmptyTitle>Let's start with you</EmptyTitle>
          <EmptyDescription>
            Tell Vita about your work, or bring an old resume. It builds your information from that and never adds
            anything you didn't say.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild className="h-11">
            <Link to="/start">Get started</Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            Prefer to type it all out? Use{" "}
            <Link to="/me/outline" className="underline underline-offset-2">
              Outline (text)
            </Link>
            .
          </p>
        </EmptyContent>
      </Empty>
    );

  const missing = missingItems(view);
  const newCard = (kind: Exclude<Adding, null>) => {
    const props = addCard(kind);
    if (!props) return null;
    const shared = { ...props, focusField: null };
    return kind === "role" ? (
      <RoleCard {...shared} />
    ) : kind === "project" ? (
      <ProjectCard {...shared} />
    ) : kind === "education" ? (
      <EducationCard {...shared} />
    ) : (
      <CertificationCard {...shared} />
    );
  };
  const section = (
    title: string,
    kind: Exclude<Adding, null>,
    label: string,
    empty: string,
    cards: React.ReactNode[],
  ) => (
    <section aria-labelledby={`info-${kind}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`info-${kind}`} className="font-display text-xl font-semibold">
          {title}
        </h2>
        <Button type="button" variant="outline" className="h-11" onClick={() => add(kind)}>
          <Plus /> {label}
        </Button>
      </div>
      {newCard(kind)}
      {cards}
      {cards.length === 0 && adding !== kind && <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );

  return (
    <InfoProvider value={context}>
      <LeaveGuard when={dirtyCards.size > 0} what="changes to your information" />
      <div className="flex max-w-3xl flex-col gap-8">
        <p className="text-muted-foreground">
          Everything your resumes are built from. Edit it here in plain fields: nothing changes in a resume until you
          update it.
        </p>
        {missing.length > 0 && !hintsHidden && (
          <Card className="border-primary/30 bg-secondary text-secondary-foreground">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <CardTitle className="font-display text-lg">Make your resumes stronger</CardTitle>
                <CardDescription className="text-secondary-foreground/80">
                  A few details recruiters look for. Tap one to fill it in.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Hide this for now"
                onClick={() => {
                  writeDraft(hintsKey, "1");
                  setHintsHidden(true);
                }}
              >
                <X />
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1">
                {missing.slice(0, maxHints).map((item) => (
                  <li key={`${item.card}:${item.field}`}>
                    <Button
                      type="button"
                      variant="link"
                      className="h-11 justify-start px-0 text-left whitespace-normal text-secondary-foreground"
                      onClick={() => jump(item)}
                    >
                      {missingText(item)}
                    </Button>
                  </li>
                ))}
              </ul>
              {missing.length > maxHints && (
                <p className="text-sm text-secondary-foreground/80">and {missing.length - maxHints} more</p>
              )}
            </CardContent>
          </Card>
        )}
        <AboutCard />
        <SummaryCard />
        {section(
          "Experience",
          "role",
          "Add role",
          "No roles yet. Add the jobs you want on your resumes.",
          view.roles.map((role) => <RoleCard key={role.id} entry={role} {...cardProps(`role:${role.id}`)} />),
        )}
        {section(
          "Projects",
          "project",
          "Add project",
          "No projects yet. Add something you built.",
          view.projects.map((project) => (
            <ProjectCard key={project.id} entry={project} {...cardProps(`project:${project.id}`)} />
          )),
        )}
        {section(
          "Education",
          "education",
          "Add education",
          "No education yet.",
          view.education.map((entry) => (
            <EducationCard key={entry.id} entry={entry} {...cardProps(`education:${entry.id}`)} />
          )),
        )}
        {section(
          "Certifications",
          "certification",
          "Add certification",
          "No certifications yet.",
          view.certifications.map((entry) => (
            <CertificationCard key={entry.id} entry={entry} {...cardProps(`certification:${entry.id}`)} />
          )),
        )}
        {view.other.length > 0 && (
          <section aria-labelledby="info-other" className="flex flex-col gap-3">
            <h2 id="info-other" className="font-display text-xl font-semibold">
              Other sections from your outline
            </h2>
            <p className="text-sm text-muted-foreground">
              These stay in your outline. They still go into your resumes.
            </p>
            <ul className="flex flex-col gap-1 rounded-xl border p-4 text-sm">
              {otherSections(view.other).map(({ section, titles }) => (
                <li key={section} className="break-words">
                  <span className="font-medium">{section}</span>
                  {titles.length > 0 && <span className="text-muted-foreground"> · {titles.join(" · ")}</span>}
                </li>
              ))}
            </ul>
            <div>
              <Button asChild variant="outline" className="h-11">
                <Link to="/me/outline">Edit in Outline (text)</Link>
              </Button>
            </div>
          </section>
        )}
      </div>
    </InfoProvider>
  );
}
