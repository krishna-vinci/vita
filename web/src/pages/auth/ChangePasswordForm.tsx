import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Shared by the forced first-sign-in change and the account menu. Other sessions are signed out by the server. */
export function ChangePasswordForm({
  onDone,
  submitLabel = "Change password",
}: {
  onDone: () => void;
  submitLabel?: string;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const invalid = !current || next.length < 8 || next !== confirm;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api.auth.changePassword({ currentPassword: current, newPassword: next });
          toast.success("Password changed.");
          onDone();
        } catch (failure) {
          setError(
            failure instanceof ApiError && failure.status === 401
              ? "The current password isn't right."
              : failure instanceof Error
                ? failure.message
                : "Could not change the password.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="pw-current">Current password</Label>
        <Input
          id="pw-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pw-new">New password</Label>
        <Input
          id="pw-new"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-sm text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pw-confirm">Confirm new password</Label>
        <Input
          id="pw-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          aria-invalid={!!confirm && confirm !== next}
          required
        />
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="h-11 w-fit" disabled={busy || invalid}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
