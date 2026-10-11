import { Check } from "lucide-react";
import { useTemplates } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Bundled and your own resume templates, with their previews. Cover-letter templates are left out. */
export function TemplateGallery({
  selected,
  onPick,
  pickLabel = "Use this",
  pending,
}: {
  selected?: string;
  onPick?: (id: string) => void;
  pickLabel?: string;
  pending?: boolean;
}) {
  const templates = useTemplates();
  if (templates.isPending)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading templates…
      </p>
    );
  if (templates.isError) return <p className="text-sm text-destructive">{templates.error.message}</p>;
  const list = templates.data.filter((template) => template.meta.kind === "resume");
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((template) => {
        const chosen = template.id === selected;
        return (
          <li
            key={template.id}
            className={cn("flex flex-col overflow-hidden rounded-xl border bg-card", chosen && "ring-2 ring-primary")}
          >
            <div className="flex aspect-[3/4] items-start justify-center overflow-hidden border-b bg-muted">
              {template.bundled && template.previewAvailable ? (
                <img
                  src={`/api/templates/${encodeURIComponent(template.id)}/preview.png`}
                  alt={`Preview of the ${template.meta.name} template`}
                  loading="lazy"
                  className="h-full w-full object-cover object-top"
                />
              ) : template.previewPdfUrl ? (
                <a
                  href={template.previewPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="m-auto text-sm text-primary underline"
                >
                  Open preview
                </a>
              ) : (
                <span className="m-auto text-sm text-muted-foreground">No preview yet</span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-medium break-words">{template.meta.name}</h3>
                <Badge variant="outline">{template.bundled ? "Built in" : "Yours"}</Badge>
              </div>
              {template.meta.description && (
                <p className="text-sm text-muted-foreground">{template.meta.description}</p>
              )}
              {onPick && (
                <Button
                  variant={chosen ? "secondary" : "outline"}
                  className="mt-auto h-11"
                  disabled={chosen || pending}
                  aria-pressed={chosen}
                  onClick={() => onPick(template.id)}
                >
                  {chosen ? (
                    <>
                      <Check /> In use
                    </>
                  ) : (
                    pickLabel
                  )}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
