import { useQueryClient } from "@tanstack/react-query";
import type { AccountUser } from "@vita/shared";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryKeys, useAuthState, useUsers } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Temporary passwords are typed once for someone else, so keep password managers from offering to save them.
const noSave = { autoComplete: "new-password", "data-1p-ignore": true, "data-lpignore": "true" } as const;
const usernamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

type Action = { kind: "reset" | "delete"; user: AccountUser } | null;

/** Admins only: who can sign in to this Vita. Each person has their own private workspace. */
export function UsersSection() {
  const me = useAuthState().data?.user;
  const users = useUsers();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<Action>(null);
  if (!me?.isAdmin) return null;
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.users });
  const update = async (user: AccountUser, patch: { isAdmin?: boolean; disabled?: boolean }, message: string) => {
    try {
      await api.admin.update(user.username, patch);
      toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work.");
    }
  };
  return (
    <section aria-labelledby="users-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="users-heading" className="font-display text-xl font-medium">
          People
        </h2>
        <Button variant="outline" className="h-11" onClick={() => setAdding(true)}>
          <UserPlus /> Add a person
        </Button>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Everyone who can sign in to this Vita. Each person has their own private outline, resumes and settings.
      </p>
      {users.isPending ? (
        <PageLoading />
      ) : users.isError ? (
        <PageError error={users.error} retry={() => void users.refetch()} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {users.data.users.map((user) => (
            <li key={user.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{user.displayName || user.username}</p>
                <p className="text-sm text-muted-foreground">{user.username}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {user.isAdmin && <Badge variant="secondary">Administrator</Badge>}
                  {user.disabled && <Badge variant="outline">Disabled</Badge>}
                  {user.mustChangePassword && <Badge variant="outline">Must choose a new password</Badge>}
                  {user.id === me.id && <Badge variant="outline">You</Badge>}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-11" aria-label={`Options for ${user.username}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setAction({ kind: "reset", user })}>
                    Reset password
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={user.id === me.id}
                    onSelect={() =>
                      void update(user, { disabled: !user.disabled }, user.disabled ? "Enabled." : "Disabled.")
                    }
                  >
                    {user.disabled ? "Enable" : "Disable"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={user.id === me.id}
                    onSelect={() =>
                      void update(
                        user,
                        { isAdmin: !user.isAdmin },
                        user.isAdmin ? "No longer an administrator." : "Now an administrator.",
                      )
                    }
                  >
                    {user.isAdmin ? "Remove administrator" : "Make administrator"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={user.id === me.id}
                    className="text-destructive"
                    onSelect={() => setAction({ kind: "delete", user })}
                  >
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <AddUserDialog open={adding} onOpenChange={setAdding} onDone={refresh} />
      <ResetDialog
        user={action?.kind === "reset" ? action.user : null}
        onClose={() => setAction(null)}
        onDone={refresh}
      />
      <DeleteDialog
        user={action?.kind === "delete" ? action.user : null}
        onClose={() => setAction(null)}
        onDone={refresh}
      />
    </section>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const invalid = !usernamePattern.test(username) || password.length < 8;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.admin.create({ username, displayName: name.trim(), password, isAdmin: admin });
      toast.success(`${username} can now sign in.`);
      setUsername("");
      setName("");
      setPassword("");
      setAdmin(false);
      onOpenChange(false);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>They will choose their own password the first time they sign in.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
            <p className="text-sm text-muted-foreground">Lowercase letters, numbers and hyphens.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-name">Name (optional)</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">Temporary password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...noSave}
            />
            <p className="text-sm text-muted-foreground">At least 8 characters. Share it with them privately.</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="new-admin" checked={admin} onCheckedChange={setAdmin} />
            <Label htmlFor="new-admin" className="cursor-pointer">
              Administrator (can add and manage people)
            </Label>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add person"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ user, onClose, onDone }: { user: AccountUser | null; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (open) return;
        setPassword("");
        onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {user?.username}</DialogTitle>
          <DialogDescription>
            They are signed out everywhere and must choose a new password the next time they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-password">Temporary password</Label>
          <Input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...noSave}
          />
          <p className="text-sm text-muted-foreground">At least 8 characters.</p>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || password.length < 8}
            onClick={async () => {
              if (!user) return;
              setBusy(true);
              try {
                await api.admin.resetPassword(user.username, password);
                toast.success("Password reset.");
                setPassword("");
                onClose();
                onDone();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not reset it.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  user,
  onClose,
  onDone,
}: {
  user: AccountUser | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {user?.username}?</DialogTitle>
          <DialogDescription>
            They will no longer be able to sign in. Their resume files stay on the server's disk, so nothing is lost,
            but this account name cannot be reused.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!user) return;
              setBusy(true);
              try {
                const result = await api.admin.remove(user.username);
                toast.success("Deleted.", {
                  description: result.workspace ? `Files kept at ${result.workspace}` : undefined,
                });
                onClose();
                onDone();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not delete.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
