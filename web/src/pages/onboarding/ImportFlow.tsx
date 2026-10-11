import { useQueryClient } from "@tanstack/react-query";
import type { OnboardingProposal } from "@vita/shared";
import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Markdown } from "@/components/Markdown";
import { Diff } from "@/components/ProposalDiff";
import { Button } from "@/components/ui/button";

function profileText(proposal: OnboardingProposal["profile"]): string {
  const { after } = proposal;
  const lines = [`Name: ${after.name}`];
  if (after.headline) lines.push(`Headline: ${after.headline}`);
  for (const contact of after.contact ?? []) lines.push(`${contact.label}: ${contact.value}`);
  return lines.join("\n");
}

/** Upload an old resume, read what Vita found as three plain diffs, then accept. Nothing is saved until then. */
export function ImportFlow({ onInterview }: { onInterview: () => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<OnboardingProposal | null>(null);
  const [each, setEach] = useState(false);
  const [applying, setApplying] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const upload = async (file: File) => {
    setBusy(true);
    try {
      setProposal(await api.onboarding.importResume(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      await api.onboarding.apply(proposal);
      await client.invalidateQueries();
      toast.success("Your outline, projects and details are saved.");
      navigate("/me/outline");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setApplying(false);
    }
  };
  if (!proposal)
    return (
      <div className="flex flex-col gap-3">
        <input
          ref={picker}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md,.rtf"
          className="sr-only"
          aria-label="Your old resume"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button className="h-11 w-fit" disabled={busy} onClick={() => picker.current?.click()}>
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <FileUp />}
          {busy ? "Reading your resume…" : "Choose a file"}
        </Button>
        <p className="text-sm text-muted-foreground">
          PDF, Word or text, up to 5 MB. You'll see everything before it's saved.
        </p>
      </div>
    );
  const sections = [
    {
      key: "outline",
      title: "Your outline",
      node: <Diff before={proposal.outline.before} after={proposal.outline.after} />,
    },
    {
      key: "projects",
      title: "Your projects and evidence",
      node: <Diff before={proposal.projects.before} after={proposal.projects.after} />,
    },
    {
      key: "profile",
      title: "Your details",
      node: <Diff before={proposal.profile.before} after={profileText(proposal.profile)} />,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="font-medium">Here's what I found. Nothing is saved yet.</p>
      {sections.map((section) => (
        <details key={section.key} open={!each} className="rounded-lg border bg-card p-3">
          <summary className="cursor-pointer font-medium">{section.title}</summary>
          <div className="mt-2 flex flex-col gap-2">
            {section.key !== "profile" && (
              <Markdown
                text={section.key === "outline" ? proposal.outline.summary : proposal.projects.summary}
                className="text-sm text-muted-foreground"
              />
            )}
            {section.node}
          </div>
        </details>
      ))}
      {proposal.questions.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="font-medium">A few things I couldn't tell</p>
          <ul className="my-2 list-disc pl-5 text-sm">
            {proposal.questions.map((question) => (
              <li key={question}>
                <Markdown inline text={question} />
              </li>
            ))}
          </ul>
          <Button variant="link" className="h-auto p-0" onClick={onInterview}>
            Answer these in a short interview
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className="h-11" disabled={applying} onClick={() => void accept()}>
          {applying ? "Saving…" : "Accept all"}
        </Button>
        <Button variant="outline" className="h-11" onClick={() => setEach((on) => !on)}>
          {each ? "Open all sections" : "Review each"}
        </Button>
        <Button variant="ghost" className="h-11" onClick={() => setProposal(null)}>
          Discard
        </Button>
      </div>
    </div>
  );
}
