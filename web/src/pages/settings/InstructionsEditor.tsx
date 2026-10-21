import { api } from "@/api/client";
import { useInstructions, useSaveInstructions } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MarkdownEditor } from "../me/MarkdownEditor";

export function InstructionsEditor() {
  const query = useInstructions();
  const save = useSaveInstructions();
  return (
    <section aria-labelledby="instructions-heading" className="flex flex-col gap-3">
      <h3 id="instructions-heading" className="font-display text-lg font-medium">
        Standing instructions
      </h3>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Guidance Vita follows every time, like "use British spelling" or "lead with teaching". It can never override the
        honesty checks.
      </p>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <PageError error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.warnings.length > 0 && (
            <Alert>
              <AlertTitle>Some lines are being ignored</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {query.data.warnings.map((warning) => (
                    <li key={warning}>
                      <Markdown inline text={warning} />
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <MarkdownEditor
            resource={query.data}
            compact
            label="Your instructions"
            save={save.mutateAsync}
            fetchLatest={() => api.instructions.get()}
            draftKey="editor:instructions"
            placeholder="- Use British spelling"
          />
        </>
      )}
    </section>
  );
}
