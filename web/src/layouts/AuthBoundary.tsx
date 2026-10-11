import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { onAuthProblem } from "@/api/client";
import { queryKeys, useAuthState } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import ForcedPasswordChange from "@/pages/auth/ForcedPasswordChange";

/** Everything except setup and sign-in sits behind this. Signed out, set-up pending or a temporary password all land here. */
export default function AuthBoundary() {
  const client = useQueryClient();
  const state = useAuthState();
  const location = useLocation();
  useEffect(() => {
    onAuthProblem(() => {
      // Drop every other cache so one person's data never shows to the next.
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.auth[0] });
      void client.invalidateQueries({ queryKey: queryKeys.auth });
    });
  }, [client]);
  if (state.isPending) return <PageLoading />;
  if (state.isError)
    return (
      <div className="mx-auto max-w-md p-6">
        <PageError error={state.error} retry={() => void state.refetch()} />
      </div>
    );
  if (state.data.setupRequired) return <Navigate to="/setup" replace />;
  if (!state.data.user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (state.data.user.mustChangePassword) return <ForcedPasswordChange />;
  return <Outlet />;
}
