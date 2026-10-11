import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryKeys, useAuthState } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordForm } from "@/pages/auth/ChangePasswordForm";

/** Your name, change password, sign out. */
export function AccountMenu() {
  const user = useAuthState().data?.user;
  const client = useQueryClient();
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  if (!user) return null;
  const name = user.displayName || user.username;
  const signOut = async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
      return;
    }
    client.clear();
    client.setQueryData(queryKeys.auth, { setupRequired: false, setupCodeRequired: false, user: null });
    navigate("/login", { replace: true });
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-11 max-w-40 gap-2 px-3" aria-label={`Account menu for ${name}`}>
            <UserRound aria-hidden="true" />
            <span className="hidden truncate sm:inline">{name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel className="flex flex-col">
            <span className="break-words">{name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {user.username}
              {user.isAdmin ? " · administrator" : ""}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={changing} onOpenChange={setChanging}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Your other signed-in devices will be signed out.</DialogDescription>
          </DialogHeader>
          <ChangePasswordForm onDone={() => setChanging(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
