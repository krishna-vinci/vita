import type { MarkdownMutation, MarkdownResource, PutMarkdownRequest } from "@vita/shared";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { Markdown } from "@/components/Markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { restoreAnchors, stripAnchors } from "@/lib/outline-anchors";
import { cn } from "@/lib/utils";

const remember = {
  get: () => {
    try {
      return localStorage.getItem("vita:mono") === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      localStorage.setItem("vita:mono", on ? "1" : "0");
    } catch {
      /* Preference just won't persist. */
    }
  },
};

function viewOf(markdown: string, hide: boolean) {
  return hide ? stripAnchors(markdown) : { display: markdown, table: new Map<string, string[]>() };
}

/** A plain Markdown editor: save needs the hash it was opened with, and a clash offers two clear ways out. */
export function MarkdownEditor({
  resource,
  label,
  save,
  fetchLatest,
  onDirty,
  placeholder,
  className,
  hideAnchors = false,
  compact = false,
}: {
  resource: MarkdownResource;
  label: string;
  save: (body: PutMarkdownRequest) => Promise<MarkdownMutation>;
  fetchLatest: () => Promise<MarkdownResource>;
  onDirty?: (dirty: boolean) => void;
  placeholder?: string;
  className?: string;
  /** Show text without `<!-- c:… -->` markers; they are put back on matching lines when saving. */
  hideAnchors?: boolean;
  /** A shorter box, for small files. */
  compact?: boolean;
}) {
  const view = (markdown: string) => viewOf(markdown, hideAnchors);
  const shown = view(resource.markdown).display;
  const [draft, setDraft] = useState(shown);
  const [baseHash, setBaseHash] = useState(resource.hash);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mono, setMono] = useState(remember.get);
  const dirty = draft !== shown;
  const last = useRef(resource);
  // Pick up changes from elsewhere (chat, undo) only while there is nothing unsaved.
  useEffect(() => {
    if (last.current.hash === resource.hash) return;
    const wasClean = draft === viewOf(last.current.markdown, hideAnchors).display;
    last.current = resource;
    if (wasClean) {
      setDraft(viewOf(resource.markdown, hideAnchors).display);
      setBaseHash(resource.hash);
    }
  }, [resource, draft, hideAnchors]);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const submit = async (hash: string | null) => {
    setSaving(true);
    try {
      const markdown = hideAnchors ? restoreAnchors(draft, view(last.current.markdown).table) : draft;
      const saved = await save({ markdown, baseHash: hash });
      last.current = saved;
      setBaseHash(saved.hash);
      setConflict(false);
      toast.success(`${label} saved.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label htmlFor="editor" className="text-muted-foreground">
          Write in your own words. Headings and bullets give it structure.
        </Label>
        <div className="flex items-center gap-2">
          <Switch
            id="mono"
            checked={mono}
            onCheckedChange={(on) => {
              setMono(on);
              remember.set(on);
            }}
          />
          <Label htmlFor="mono" className="cursor-pointer text-muted-foreground">
            Fixed-width font
          </Label>
        </div>
      </div>
      <fieldset className="flex gap-1 border-0 p-0" aria-label="View">
        <Button
          type="button"
          size="sm"
          variant={preview ? "ghost" : "secondary"}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Write
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preview ? "secondary" : "ghost"}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
      </fieldset>
      {preview ? (
        <Markdown
          text={draft || "_Nothing written yet._"}
          className={cn(
            "overflow-auto rounded-md border bg-card p-4 text-base",
            compact ? "min-h-48" : "min-h-[55dvh]",
          )}
        />
      ) : (
        <Textarea
          id="editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          spellCheck
          aria-label={label}
          className={cn(
            compact ? "min-h-48 leading-relaxed" : "min-h-[55dvh] leading-relaxed",
            mono ? "font-mono text-sm" : "text-base",
          )}
        />
      )}
      {conflict && (
        <Alert variant="destructive">
          <AlertTitle>This changed somewhere else</AlertTitle>
          <AlertDescription>
            <p>Your version and the saved version are different. Choose which one to keep.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const latest = await fetchLatest();
                  last.current = latest;
                  setDraft(view(latest.markdown).display);
                  setBaseHash(latest.hash);
                  setConflict(false);
                }}
              >
                Load the saved version (drops mine)
              </Button>
              <Button variant="outline" onClick={async () => submit((await fetchLatest()).hash)}>
                Keep mine (replaces the saved one)
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-11" disabled={!dirty || saving} onClick={() => void submit(baseHash)}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {dirty && (
          <Button variant="ghost" className="h-11" onClick={() => setDraft(shown)}>
            Discard changes
          </Button>
        )}
        <span className="text-sm text-muted-foreground" role="status">
          {dirty ? "You have unsaved changes." : "All changes saved."}
        </span>
      </div>
    </div>
  );
}
