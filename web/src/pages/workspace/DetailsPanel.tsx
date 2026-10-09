import type { ApplicationResource, JobView, Resume, Review } from "@vita/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost, requirementCovered, visibleText } from "@/lib/resume-view";

/** Everything the default view hides: job match, checker notes, tokens and cost. */
export function DetailsPanel({
  resume,
  analysis,
  gaps,
  review,
  jobs,
}: {
  resume: Resume;
  analysis?: ApplicationResource["analysis"];
  gaps: string[];
  review: Review | null;
  jobs: JobView[];
}) {
  const text = visibleText(resume);
  const gapIds = new Set(gaps.map((gap) => gap.split(":")[0]));
  const usage = jobs.flatMap((job) => job.usage);
  const input = usage.reduce((sum, entry) => sum + entry.input, 0);
  const output = usage.reduce((sum, entry) => sum + entry.output, 0);
  const cost = usage.reduce((sum, entry) => sum + entry.costUsd, 0);
  const lineNotes =
    review?.lint.filter((finding) => finding.severity === "warn").map((finding) => finding.message) ?? [];
  const keywordNotes = review?.ats.map((note) => note.message) ?? [];
  return (
    <Card aria-label="Details" className="font-sans text-sm">
      <CardHeader>
        <CardTitle className="font-display text-lg">Details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        {analysis && (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Job match</h3>
            <ul className="flex flex-col gap-1.5">
              {analysis.requirements.map((requirement) => {
                const gap = requirement.importance === "must" && gapIds.has(requirement.id);
                const covered = !gap && requirementCovered(text, requirement.keywords);
                return (
                  <li key={requirement.id} className="grid grid-cols-[1.25rem_1fr] gap-1">
                    <span aria-hidden="true" className={covered ? "text-success" : "text-muted-foreground"}>
                      {covered ? "✓" : "–"}
                    </span>
                    <span>
                      {requirement.text}
                      <span className="block text-xs text-muted-foreground">
                        {gap
                          ? "Not in your notes yet. This is a gap to prepare for."
                          : covered
                            ? "Covered by your work"
                            : "Not mentioned on this resume"}
                        {requirement.importance === "nice" ? " · nice to have" : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-medium">Line checks</h3>
            {review ? (
              <p className="text-muted-foreground">
                {review.checks.filter((note) => note.verdict === "supported").length} of {review.checks.length} lines
                match your evidence. {review.round > 1 ? `Took ${review.round} drafts.` : ""}
              </p>
            ) : (
              <p className="text-muted-foreground">This resume has not been checked yet.</p>
            )}
            {lineNotes.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {lineNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="font-medium">Keyword check</h3>
            {keywordNotes.length ? (
              <ul className="list-disc pl-5 text-muted-foreground">
                {keywordNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No keyword problems found.</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="font-medium">This run</h3>
            <p className="text-muted-foreground">
              {usage.length
                ? `${(input + output).toLocaleString()} tokens · ${formatCost(cost)} (since the app last started)`
                : "No usage recorded since the app last started."}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
