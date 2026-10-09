import type { McpConfig } from "@vita/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useMcp, useSaveMcp } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Server = McpConfig["mcpServers"][string];
const secretNote = (values?: Record<string, string>) =>
  values && Object.keys(values).length
    ? Object.entries(values)
        .map(([key, value]) => `${key} = ${value === "[redacted]" ? "••••••" : value}`)
        .join(", ")
    : "";

function Servers({ config }: { config: McpConfig }) {
  const save = useSaveMcp();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const persist = (next: McpConfig, message: string) =>
    save.mutate(next, { onSuccess: () => toast.success(message), onError: (error) => toast.error(error.message) });
  const set = (id: string, patch: Partial<Server>) =>
    persist(
      { ...config, mcpServers: { ...config.mcpServers, [id]: { ...config.mcpServers[id], ...patch } as Server } },
      "Saved.",
    );
  const add = () => {
    const isUrl = /^https?:\/\//.test(target.trim());
    const [command = "", ...args] = target.trim().split(/\s+/);
    const server: Server = isUrl ? { url: target.trim() } : { command, ...(args.length ? { args } : {}) };
    persist({ ...config, mcpServers: { ...config.mcpServers, [name.trim()]: server } }, "Added.");
    setName("");
    setTarget("");
  };
  const entries = Object.entries(config.mcpServers);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No integrations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([id, server]) => {
            const secrets = secretNote("env" in server ? server.env : "headers" in server ? server.headers : undefined);
            return (
              <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{id}</p>
                  <p className="text-sm break-all text-muted-foreground">
                    {"url" in server ? server.url : [server.command, ...(server.args ?? [])].join(" ")}
                  </p>
                  {secrets && <p className="text-xs break-all text-muted-foreground">Secrets: {secrets}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`mcp-${id}`}
                    checked={server.enabled !== false}
                    disabled={save.isPending}
                    onCheckedChange={(enabled) => set(id, { enabled })}
                  />
                  <Label htmlFor={`mcp-${id}`} className="cursor-pointer text-sm text-muted-foreground">
                    On
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`Remove ${id}`}
                    disabled={save.isPending}
                    onClick={() => {
                      const { [id]: _removed, ...rest } = config.mcpServers;
                      persist({ ...config, mcpServers: rest }, "Removed.");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="mcp-name">Name</Label>
          <Input
            id="mcp-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="github"
            pattern="[a-zA-Z0-9_\-]+"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mcp-target">Address or command</Label>
          <Input
            id="mcp-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="https://… or npx some-server"
            required
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="h-11"
          disabled={save.isPending || !name.trim() || !target.trim()}
        >
          Add
        </Button>
      </form>
    </div>
  );
}

export function McpSection() {
  const query = useMcp();
  return (
    <section aria-labelledby="mcp-heading" className="flex flex-col gap-3">
      <h3 id="mcp-heading" className="font-display text-lg font-medium">
        Integrations
      </h3>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Connect tools Vita can use when looking things up, like GitHub. Secret values stay on the server and are never
        shown.
      </p>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <PageError error={query.error} retry={() => void query.refetch()} />
      ) : (
        <Servers config={query.data} />
      )}
    </section>
  );
}
