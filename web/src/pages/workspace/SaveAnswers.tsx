import { useQueryClient } from "@tanstack/react-query";
import type { SourceProposal } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ProposalReview } from "@/components/ProposalDiff";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Your "yes" answers are only for this job until you save them to your profile. */
export function SaveAnswers({ applicationId }: { applicationId: string }) {
  const [proposal, setProposal] = useState<SourceProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setProposal((await api.memory.promoteAnswers(applicationId)).proposal);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Nothing to save yet.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : "Save to my profile"}
      </Button>
      <Dialog open={!!proposal} onOpenChange={(open) => !open && setProposal(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Save your answers to your profile</DialogTitle>
            <DialogDescription>Then every future resume can use them. You decide.</DialogDescription>
          </DialogHeader>
          {proposal && (
            <ProposalReview
              proposal={proposal}
              onDone={(accepted) => {
                if (accepted) void client.invalidateQueries();
                setProposal(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
