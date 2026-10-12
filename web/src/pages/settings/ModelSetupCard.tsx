import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const commands = [
  { label: "Running in Docker", command: "docker compose exec -it vita pnpm vita login" },
  { label: "Running natively", command: "pnpm vita login" },
] as const;

function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-md border bg-muted p-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all">{command}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 shrink-0"
          aria-label={`Copy command: ${command}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Could not copy. Select the command and copy it yourself.");
            }
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** Shown when no model has credentials yet: the exact steps to sign in, with the commands ready to copy. */
export function ModelSetupCard({
  hints,
  onReload,
  reloading,
}: {
  hints: string[];
  onReload: () => void;
  reloading: boolean;
}) {
  return (
    <section aria-labelledby="setup-models" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <h2 id="setup-models" className="font-display text-xl font-medium">
        Connect a model provider
      </h2>
      <p className="text-sm text-muted-foreground">
        Vita needs access to a model to write and check your resumes. Sign in once from a terminal on the server.
      </p>
      <div className="flex flex-col gap-3">
        {commands.map((entry) => (
          <CopyCommand key={entry.command} {...entry} />
        ))}
      </div>
      <ol className="list-decimal pl-5 text-sm">
        <li>
          Type <code className="font-mono">/login</code>, choose your provider, and finish the step in your browser.
        </li>
        <li>
          Then type <code className="font-mono">/quit</code>.
        </li>
        <li>Come back here and press Reload.</li>
      </ol>
      {hints.length > 0 && (
        <div>
          <p className="text-sm font-medium">More ways to connect</p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {hints.map((hint) => (
              <li key={hint} className="break-words">
                {hint}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="h-11" onClick={onReload} disabled={reloading}>
          {reloading ? "Checking…" : "Reload"}
        </Button>
        <a
          href="https://github.com/krishna-vinci/vita/blob/main/docs/SELF_HOSTING.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline underline-offset-2"
        >
          Full guide
        </a>
      </div>
    </section>
  );
}
