import { useQueryClient } from "@tanstack/react-query";
import type { MemoryProposal } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { Button } from "@/components/ui/button";

export const memoryKindLabel = {
  preference: "Preference",
  decision: "Decision",
  fact: "Fact to confirm",
  outcome: "Outcome",
} as const;

function Proposal({ proposal }: { proposal: MemoryProposal }) {
  const [state, setState] = useState<"open" | "saved" | "dismissed">("open");
  const client = useQueryClient();
  if (state === "dismissed") return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-background p-2 text-sm">
      <p>
        <span className="font-medium">Remember this?</span> <span className="break-words">{proposal.entry.text}</span>
      </p>
      <p className="text-xs text-muted-foreground">{memoryKindLabel[proposal.entry.kind]}</p>
      {state === "saved" ? (
        <p className="text-xs text-muted-foreground">Remembered.</p>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.memory.applyProposal(proposal);
                setState("saved");
                await client.invalidateQueries({ queryKey: queryKeys.memory });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not save that.");
              }
            }}
          >
            Remember
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState("dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

/** Things Vita noticed in a chat and would like to remember. Nothing is kept until you say so. */
export function MemoryProposals({ proposals }: { proposals?: MemoryProposal[] }) {
  if (!proposals?.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {proposals.map((proposal) => (
        <Proposal key={proposal.entry.id} proposal={proposal} />
      ))}
    </div>
  );
}
