import type { TemplateContract } from "@vita/shared";
import { Plus } from "lucide-react";
import { useRef } from "react";
import { useTemplateContract } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { useScrollMemory } from "@/lib/use-scroll-memory";

/** One line each; the contract itself only carries the code. */
const snippetAbout: Record<string, string> = {
  icons: "Contact icons from the fontawesome5 set.",
  links: "Entry links with a small icon after the label.",
  footer: "Page numbers in the footer, with your name.",
  "two-column-skills": "Skills in two columns, one category per line.",
  location: "Your location under the header, if you set one.",
  accent: "An accent colour you can reuse in rules and headings.",
};
const aboutSnippet = (name: string) => snippetAbout[name] ?? `The ${name} snippet.`;

function Entries({ items }: { items: Record<string, string> }) {
  return (
    <dl className="flex flex-col gap-2 text-xs">
      {Object.entries(items).map(([name, about]) => (
        <div key={name} className="min-w-0">
          <dt className="font-mono font-medium break-words">{name}</dt>
          <dd className="text-muted-foreground">{about}</dd>
        </div>
      ))}
    </dl>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-md border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">{title}</summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}

/** What a template may use: the delimiters, variables and filters, and snippets that insert at the cursor. */
export function StudioReference({ onInsert, canInsert }: { onInsert: (code: string) => void; canInsert: boolean }) {
  const contract = useTemplateContract();
  const pane = useRef<HTMLDivElement>(null);
  useScrollMemory(pane, "studio-reference", contract.isSuccess);
  if (contract.isPending)
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        Loading the reference…
      </p>
    );
  if (contract.isError) return <p className="p-3 text-sm text-destructive">{contract.error.message}</p>;
  const data: TemplateContract = contract.data;
  return (
    <div ref={pane} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-1">
      <section aria-label="Delimiters" className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Delimiters</h3>
        <p className="font-mono text-xs break-words text-muted-foreground">((( ))) ((* *)) ((= =))</p>
        <p className="text-xs text-muted-foreground">Value, tag and comment. Plain braces are left to LaTeX.</p>
      </section>
      <section aria-label="Snippets" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Snippets</h3>
        <ul className="flex flex-col gap-2">
          {Object.entries(data.snippets).map(([name, code]) => (
            <li key={name} className="flex items-start gap-2 rounded-md border bg-card p-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-medium break-words">{name}</p>
                <p className="text-xs text-muted-foreground">{aboutSnippet(name)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                disabled={!canInsert}
                aria-label={`Insert ${name}`}
                onClick={() => onInsert(code)}
              >
                <Plus /> Insert
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <Fold title="Variables">
        <Entries items={data.variables} />
      </Fold>
      <Fold title="Filters">
        <Entries items={data.filters} />
      </Fold>
    </div>
  );
}
