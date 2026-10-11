import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys, useAuthState } from "@/api/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "./AuthLayout";

const usernamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

export default function SetupPage() {
  const state = useAuthState();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (state.isPending) return null;
  if (state.data && !state.data.setupRequired) return <Navigate to={state.data.user ? "/" : "/login"} replace />;
  const needsCode = !!state.data?.setupCodeRequired;
  const invalid =
    !usernamePattern.test(username) || password.length < 8 || password !== confirm || (needsCode && !code.trim());
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const { user } = await api.auth.setup({
        username,
        displayName: displayName.trim(),
        password,
        ...(needsCode ? { setupCode: code.trim() } : {}),
      });
      client.clear();
      client.setQueryData(queryKeys.auth, { setupRequired: false, setupCodeRequired: false, user });
      navigate("/", { replace: true });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 403
          ? "That setup code isn't right. Check the server log for the code."
          : failure instanceof Error
            ? failure.message
            : "Could not create the account.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Set up Vita" subtitle="Create the first account. It will be the administrator.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {needsCode && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-code">Setup code</Label>
            <Input
              id="setup-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <p className="text-sm text-muted-foreground">
              This server isn't only reachable from this computer, so it printed a one-time code in its log.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-username">Username</Label>
          <Input
            id="setup-username"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={!!username && !usernamePattern.test(username)}
            required
          />
          <p className="text-sm text-muted-foreground">Lowercase letters, numbers and hyphens.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-name">Your name (optional)</Label>
          <Input
            id="setup-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-password">Password</Label>
          <Input
            id="setup-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="text-sm text-muted-foreground">At least 8 characters.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-confirm">Confirm password</Label>
          <Input
            id="setup-confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            aria-invalid={!!confirm && confirm !== password}
            required
          />
        </div>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-11" disabled={busy || invalid}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
