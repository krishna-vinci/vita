import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useGithub } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Public repositories need no setup. A read-only token adds private ones. The token is never shown again. */
export function GithubCard() {
  const status = useGithub();
  const client = useQueryClient();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["github"] });
  const unavailable = status.error instanceof ApiError && [404, 501].includes(status.error.status);
  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-card p-4">
      <h4 className="font-medium">GitHub</h4>
      <p className="text-sm text-muted-foreground">
        Public repositories work without setup. Add a fine-grained read-only token for private repositories (Contents:
        read, Metadata: read).{" "}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          Create a token on GitHub
        </a>
      </p>
      {status.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Checking…
        </p>
      ) : unavailable || status.isError ? (
        <p className="text-sm text-muted-foreground">
          GitHub connection isn't available on this server yet. Public repositories still work.
        </p>
      ) : status.data.connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            Connected as <strong>{status.data.login ?? "your account"}</strong>
            {status.data.rateLimit?.remaining !== undefined
              ? ` · ${status.data.rateLimit.remaining} requests left this hour`
              : ""}
          </p>
          <Button
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.github.disconnect();
                toast.success("Disconnected.");
                await refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not disconnect.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api.github.save(token.trim());
              setToken("");
              toast.success("Connected.");
              await refresh();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "That token didn't work.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-2">
            <Label htmlFor="gh-token">Token</Label>
            <Input
              id="gh-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              spellCheck={false}
              placeholder="github_pat_…"
            />
          </div>
          <Button type="submit" className="h-11" disabled={busy || !token.trim()}>
            {busy ? "Checking…" : "Connect"}
          </Button>
        </form>
      )}
    </div>
  );
}
