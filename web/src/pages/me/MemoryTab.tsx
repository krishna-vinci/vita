import { useQueryClient } from "@tanstack/react-query";
import type { MemoryEntry, MemoryKind } from "@vita/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryKeys, useMemory } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { memoryKindLabel } from "@/components/MemoryProposals";
import { PageError, PageLoading } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const groups: { kind: MemoryKind; title: string; hint: string }[] = [
  { kind: "preference", title: "Preferences", hint: "How you like your resumes to read." },
  { kind: "decision", title: "Decisions", hint: "Choices you've made, so Vita doesn't ask again." },
  { kind: "fact", title: "Facts to confirm", hint: "Things Vita heard but hasn't checked with evidence." },
  { kind: "outcome", title: "Outcomes", hint: "What happened with your applications." },
];

export default function MemoryTab() {
  const memory = useMemory();
  const client = useQueryClient();
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.memory });
  const add = async () => {
    setBusy(true);
    try {
      await api.memory.add({ kind, text: text.trim(), apply: true });
      setText("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (entry: MemoryEntry) => {
    try {
      await api.memory.remove(entry.id);
      toast.success("Forgotten.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove it.");
    }
  };
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <p className="text-muted-foreground">
        Small notes Vita keeps so it gets to know you. They guide how it writes, and you can remove any of them. Keep
        passwords and contact details out of here.
      </p>
      <form
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[11rem_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="mem-kind">Kind</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as MemoryKind)}>
            <SelectTrigger id="mem-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.kind} value={group.kind}>
                  {memoryKindLabel[group.kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mem-text">Something to remember</Label>
          <Input
            id="mem-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g. I prefer short bullet points"
            autoComplete="off"
          />
        </div>
        <Button type="submit" className="h-11" disabled={busy || !text.trim()}>
          Remember
        </Button>
      </form>
      {memory.isPending ? (
        <PageLoading />
      ) : memory.isError ? (
        <PageError error={memory.error} retry={() => void memory.refetch()} />
      ) : (
        groups.map((group) => {
          const entries = memory.data.entries.filter((entry) => entry.kind === group.kind);
          return (
            <section key={group.kind} aria-label={group.title} className="flex flex-col gap-2">
              <h2 className="font-display text-lg font-medium">{group.title}</h2>
              <p className="text-sm text-muted-foreground">{group.hint}</p>
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing here yet.</p>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <Markdown inline text={entry.text} />
                        <p className="text-xs text-muted-foreground">
                          {entry.at} · {entry.source === "user" ? "added by you" : `from ${entry.source}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={`Forget: ${entry.text}`}
                        onClick={() => void remove(entry)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
