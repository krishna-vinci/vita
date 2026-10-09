import { useState } from "react";
import { usePrompt } from "@/api/queries";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const roles = [
  ["writer", "Writing the resume"],
  ["analyst", "Reading the job"],
  ["checker", "Checking the facts"],
  ["ats-reviewer", "Checking the job match"],
  ["resume-editor", "Editing your resume in chat"],
  ["source-editor", "Editing your outline in chat"],
  ["interviewer", "Interview prep"],
  ["researcher", "Looking things up"],
  ["template-adopter", "Adapting templates"],
] as const;

export function PromptViewer() {
  const [role, setRole] = useState<string>("writer");
  const prompt = usePrompt(role, true);
  return (
    <section aria-labelledby="prompt-heading" className="flex flex-col gap-3">
      <h3 id="prompt-heading" className="font-display text-lg font-medium">
        What each assistant sees
      </h3>
      <p className="max-w-2xl text-sm text-muted-foreground">
        The full instructions an assistant gets, including your standing instructions. Read-only.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="prompt-role">Assistant</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger id="prompt-role" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {prompt.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading…
        </p>
      ) : prompt.isError ? (
        <p className="text-sm text-destructive">{prompt.error.message}</p>
      ) : (
        <Textarea
          readOnly
          value={prompt.data.prompt}
          aria-label="What this assistant sees"
          className="h-96 max-w-3xl font-mono text-xs"
        />
      )}
    </section>
  );
}
