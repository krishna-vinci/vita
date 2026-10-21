import { slugify } from "@vita/shared";
import { FileUp, FolderOpen, Link2, PencilLine, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { useProjects, useSaveProjects } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { PageError, PageLoading } from "@/components/PageState";
import { SplitWithChat } from "@/components/SplitWithChat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { type ProjectCard, parseProjects, plural } from "@/lib/projects-view";
import { useUrlFlag } from "@/lib/use-url-state";
import { ImportDialog } from "./ImportDialog";
import { MarkdownEditor } from "./MarkdownEditor";
import { MetricCard } from "./MetricCard";
import { ProjectRole, roleLabels } from "./ProjectRole";
import { ResearchDialog } from "./ResearchDialog";
import { SourceChat } from "./SourceChat";

export default function ProjectsTab() {
  const query = useProjects();
  const save = useSaveProjects();
  // "Edit as text" is in the URL, so a reload stays in the editor. It adds no Back step.
  const [editing, setEditing] = useUrlFlag("edit");
  const [dirty, setDirty] = useState(false);
  const cards = useMemo(() => parseProjects(query.data?.markdown ?? ""), [query.data?.markdown]);
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError error={query.error} retry={() => void query.refetch()} />;
  const toggle = (
    <Button variant="outline" className="h-11" onClick={() => setEditing(!editing)}>
      <PencilLine /> {editing ? "Back to the list" : "Edit as text"}
    </Button>
  );
  if (editing)
    return (
      <SplitWithChat chat={<SourceChat dirty={dirty} className="h-full" />}>
        <div className="mb-4">{toggle}</div>
        <MarkdownEditor
          resource={query.data}
          label="Your projects"
          save={save.mutateAsync}
          fetchLatest={() => api.projects.get()}
          onDirty={setDirty}
          draftKey="editor:projects"
        />
      </SplitWithChat>
    );
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-muted-foreground">
        The proof behind your resumes: what you did, the evidence for it, and what you may not claim. Vita checks every
        line of a resume against this.
      </p>
      <div className="flex flex-wrap gap-3">
        {toggle}
        <ResearchDialog
          trigger={
            <Button variant="outline" className="h-11">
              <Link2 /> Add from GitHub or a link
            </Button>
          }
        />
        <ImportDialog
          trigger={
            <Button variant="outline" className="h-11">
              <FileUp /> Import old notes
            </Button>
          }
        />
      </div>
      <MetricCard />
      {cards.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              Start by writing your outline or importing an old resume. Your projects and evidence will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <li key={card.title}>
              <ProjectItem card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectItem({ card }: { card: ProjectCard }) {
  const [roleOpen, setRoleOpen] = useState(false);
  const canSetRole = card.relationship !== undefined || card.repoUrl !== "";
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="font-display text-lg break-words">{card.title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {[card.kind, card.period].filter(Boolean).join(" · ")}
          {card.checkedAt ? ` · checked ${card.checkedAt}` : ""}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{plural(card.facts, "fact")} you can use</Badge>
          <Badge variant="outline">{plural(card.evidence, "piece")} of evidence</Badge>
          {card.variants > 0 && (
            <Badge variant="outline">{plural(card.variants, "ready-made wording", "ready-made wordings")}</Badge>
          )}
          {canSetRole && (
            <button type="button" onClick={() => setRoleOpen(true)} aria-label={`Edit your role in ${card.title}`}>
              {card.relationship ? (
                <Badge variant="outline">Role: {roleLabels[card.relationship]}</Badge>
              ) : (
                <Badge variant="outline">Set your role</Badge>
              )}
            </button>
          )}
        </div>
        {canSetRole && (
          <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Your role in {card.title}</DialogTitle>
                <DialogDescription>Vita uses this to decide what you may claim about the project.</DialogDescription>
              </DialogHeader>
              <ProjectRole
                slug={slugify(card.title)}
                repoUrl={card.repoUrl || undefined}
                value={card.relationship}
                contribution={card.contribution}
              />
            </DialogContent>
          </Dialog>
        )}
        <div>
          <ResearchDialog
            title={`Refresh ${card.title} from its source`}
            initial={{ target: card.title, itemSlug: slugify(card.title) }}
            trigger={
              <Button variant="ghost" size="sm" className="-ml-2">
                <RefreshCw /> Refresh from source
              </Button>
            }
          />
        </div>
        {card.limits.length > 0 && (
          <div>
            <p className="font-medium">What you may not claim</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {card.limits.map((limit) => (
                <li key={limit}>
                  <Markdown inline text={limit} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
