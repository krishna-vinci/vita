import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys, useAuthState } from "@/api/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "./AuthLayout";

function waitText(seconds?: number): string {
  if (!seconds) return "a few minutes";
  return seconds >= 120 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

export default function LoginPage() {
  const state = useAuthState();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (state.data?.setupRequired) return <Navigate to="/setup" replace />;
  if (state.data?.user) return <Navigate to="/" replace />;
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const { user } = await api.auth.login({ username: username.trim().toLowerCase(), password });
      client.clear();
      client.setQueryData(queryKeys.auth, { setupRequired: false, setupCodeRequired: false, user });
      navigate(from, { replace: true });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429)
        setError(`Too many tries. Please wait ${waitText(failure.retryAfter)} and try again.`);
      else if (failure instanceof ApiError && failure.status === 401)
        setError("That username or password isn't right.");
      else setError(failure instanceof Error ? failure.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your resume studio.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-username">Username</Label>
          <Input
            id="login-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-11" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
