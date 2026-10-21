import { FileUp } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useOutline, useSaveOutline } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { SplitWithChat } from "@/components/SplitWithChat";
import { Button } from "@/components/ui/button";
import { ImportDialog } from "./ImportDialog";
import { MarkdownEditor } from "./MarkdownEditor";
import { SourceChat } from "./SourceChat";

export default function OutlineTab() {
  const query = useOutline();
  const save = useSaveOutline();
  const [dirty, setDirty] = useState(false);
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError error={query.error} retry={() => void query.refetch()} />;
  const empty = !query.data.markdown.trim() && !dirty;
  return (
    <SplitWithChat chat={<SourceChat dirty={dirty} className="h-full" draftKey="chat:outline" />}>
      {empty && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-card p-5">
          <h2 className="font-display text-xl font-medium">
            Start by writing your outline or importing an old resume.
          </h2>
          <p className="text-muted-foreground">
            Everything you know about your work goes here, in your own words and unfiltered. Vita builds your resumes
            from it, and never adds anything you didn't say.
          </p>
          <div>
            <ImportDialog
              trigger={
                <Button variant="outline" className="h-11">
                  <FileUp /> Import an old resume
                </Button>
              }
            />
          </div>
        </div>
      )}
      <MarkdownEditor
        resource={query.data}
        label="Your outline"
        save={save.mutateAsync}
        fetchLatest={() => api.outline.get()}
        onDirty={setDirty}
        draftKey="editor:outline"
        hideAnchors
        placeholder={
          "# Your name\n\n## Experience\n\n### Company — Role\n2023–2026\n\n- What you did, in your own words"
        }
      />
      <p className="mt-4 text-sm text-muted-foreground">
        Looking for your evidence and what you may claim? That's in{" "}
        <Link to="/me/projects" className="underline underline-offset-2">
          Projects
        </Link>
        .
      </p>
    </SplitWithChat>
  );
}
