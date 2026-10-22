import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreview } from "@/api/queries";
import { Button } from "@/components/ui/button";

/** Wait this long after the last change before rendering, so a burst of edits makes one PDF. */
export const previewDebounceMs = 800;
/** A PDF that never reports `load` is shown anyway after this long. */
const swapFallbackMs = 4000;

type Scope = "application" | "resume";

/**
 * The real PDF of the resume as it is now. `version` changes whenever the resume does (its content hash):
 * the pane then asks the server for a fresh render after a short pause, and keeps the old PDF on screen
 * until the new one has loaded.
 */
export function PreviewPane({
  scope,
  id,
  version,
  className,
}: {
  scope: Scope;
  id: string;
  version: string;
  className?: string;
}) {
  const render = usePreview(scope, id);
  const [shown, setShown] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const mutate = render.mutateAsync;
  // Only the latest request may change what is shown.
  const latest = useRef(0);

  const request = useCallback(async () => {
    const ticket = ++latest.current;
    setRendering(true);
    try {
      const { url } = await mutate();
      if (ticket !== latest.current) return;
      setFailure(null);
      setIncoming(url);
    } catch (error) {
      if (ticket !== latest.current) return;
      setFailure(error instanceof Error ? error.message : "Couldn't render the preview.");
      setRendering(false);
    }
  }, [mutate]);

  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new version is the trigger.
  useEffect(() => {
    // The first render has no PDF to protect, so it starts at once. Later changes wait for a pause.
    if (first.current) {
      first.current = false;
      void request();
      return;
    }
    setRendering(true);
    const timer = setTimeout(() => void request(), previewDebounceMs);
    return () => clearTimeout(timer);
  }, [version, request]);

  // Swap to the new PDF once it has loaded behind the old one (or after a fallback delay).
  const swap = useCallback((url: string) => {
    setShown(url);
    setIncoming((current) => (current === url ? null : current));
    setRendering(false);
  }, []);
  useEffect(() => {
    if (!incoming) return;
    if (incoming === shown) {
      setIncoming(null);
      setRendering(false);
      return;
    }
    const timer = setTimeout(() => swap(incoming), swapFallbackMs);
    return () => clearTimeout(timer);
  }, [incoming, shown, swap]);

  const src = (url: string) => `${url}#toolbar=0&navpanes=0&view=FitH`;
  return (
    <div className={className} data-testid="preview-pane">
      <div className="flex min-h-9 items-center justify-between gap-2 pb-2 text-sm text-muted-foreground">
        <span role="status" aria-live="polite" className="flex items-center gap-2">
          {rendering && !failure && (
            <>
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {shown ? "Updating preview…" : "Rendering preview…"}
            </>
          )}
        </span>
        {shown && (
          <Button variant="ghost" size="sm" asChild className="h-9">
            <a href={shown} target="_blank" rel="noreferrer">
              <ExternalLink /> Open PDF
            </a>
          </Button>
        )}
      </div>
      {failure && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm"
        >
          <p className="font-medium">Couldn't render the preview</p>
          <p className="max-h-32 w-full overflow-auto break-words whitespace-pre-wrap text-muted-foreground">
            {failure}
          </p>
          <Button variant="outline" className="h-11" onClick={() => void request()}>
            <RefreshCw /> Retry
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/40">
        {shown ? (
          <iframe
            key="shown"
            title="Resume preview"
            src={src(shown)}
            className="absolute inset-0 size-full bg-white"
            aria-busy={rendering}
          />
        ) : (
          !failure && <div className="absolute inset-0 animate-pulse bg-muted/60 motion-reduce:animate-none" />
        )}
        {incoming && incoming !== shown && (
          <iframe
            key={incoming}
            title="Resume preview, updating"
            aria-hidden="true"
            tabIndex={-1}
            src={src(incoming)}
            className="pointer-events-none absolute inset-0 size-full bg-white opacity-0"
            onLoad={() => swap(incoming)}
          />
        )}
      </div>
    </div>
  );
}
