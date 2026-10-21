import { cn } from "@/lib/utils";

/** A unified diff: added lines green, removed red, hunk headers muted. */
export function DiffView({ diff, label = "Changes to the template" }: { diff: string; label?: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <section aria-label={label} className="max-h-80 overflow-auto rounded-md border bg-muted/40 py-2">
      <pre className="font-mono text-xs leading-5">
        {lines.map((line, index) => {
          const kind = line.startsWith("@@")
            ? "hunk"
            : line.startsWith("+++") || line.startsWith("---") || line.startsWith("Index:") || line.startsWith("====")
              ? "file"
              : line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "remove"
                  : "context";
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity.
              key={index}
              data-diff={kind}
              className={cn(
                "min-w-fit px-3 whitespace-pre",
                kind === "add" && "bg-success/15 text-success",
                kind === "remove" && "bg-destructive/15 text-destructive",
                (kind === "hunk" || kind === "file") && "text-muted-foreground",
              )}
            >
              {line || " "}
            </div>
          );
        })}
      </pre>
    </section>
  );
}
