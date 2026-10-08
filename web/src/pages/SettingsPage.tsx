import { PutSettingsRequest, type SettingsView } from "@vita/shared";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useSaveSettings, useSettings } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

const roles = [
  { id: "analyst", label: "Reading the job" },
  { id: "writer", label: "Writing the resume" },
  { id: "checker", label: "Checking the facts" },
  { id: "ats-reviewer", label: "Checking the job match" },
] as const;

function SettingsForm({ settings }: { settings: SettingsView }) {
  const [draft, setDraft] = useState<PutSettingsRequest>({ models: settings.models, template: settings.template });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSettings();
  const [choices] = useState(() => [...new Set([settings.models.default, ...Object.values(settings.models.roles)])]);
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(roles.map(({ id }) => [id, settings.models.roles[id] ?? "__default__"])),
  );
  const customValue = "__custom__";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = PutSettingsRequest.safeParse(draft);
    if (!result.success) {
      setError("Use provider/model for each model, and a template ID with lowercase letters, numbers or hyphens.");
      return;
    }
    setError(null);
    save.mutate(result.data, {
      onSuccess: () => toast.success("Settings saved"),
      onError: (failure) => setError(failure.message),
    });
  };
  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-8">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="default-model">Default model</FieldLabel>
          <Input
            id="default-model"
            value={draft.models.default}
            onChange={(event) => setDraft({ ...draft, models: { ...draft.models, default: event.target.value } })}
            placeholder="provider/model"
            required
            disabled={save.isPending}
          />
          <FieldDescription>Used for every step unless you choose a different model below.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="template">Default template</FieldLabel>
          <Input
            id="template"
            value={draft.template}
            onChange={(event) => setDraft({ ...draft, template: event.target.value })}
            required
            disabled={save.isPending}
          />
          <FieldDescription>The ID of an installed resume template, such as rover-base.</FieldDescription>
        </Field>
      </FieldGroup>
      <Separator />
      <section aria-labelledby="credentials-heading" className="flex flex-col gap-4">
        <h2 id="credentials-heading" className="font-display text-xl font-medium">
          Provider access
        </h2>
        <p className="text-sm text-muted-foreground">
          Credentials come from your server's environment or Pi sign-in. Keys stay on the server.
        </p>
        <ScrollArea className="h-64 rounded-md border px-4" tabIndex={0} aria-label="Provider credential status">
          <ul className="divide-y">
            {settings.providers.map((provider) => (
              <li key={provider.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="break-all">{provider.id}</span>
                <Badge variant={provider.hasCredentials ? "secondary" : "outline"}>
                  {provider.hasCredentials ? "Credentials available" : "No credentials found"}
                </Badge>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </section>
      <Separator />
      <Field orientation="horizontal">
        <FieldLabel htmlFor="advanced">Advanced: models for each step</FieldLabel>
        <Switch id="advanced" checked={advanced} onCheckedChange={setAdvanced} aria-controls="role-models" />
      </Field>
      {advanced && (
        <FieldGroup id="role-models">
          <FieldDescription>Use a different model to check the writer's work.</FieldDescription>
          {roles.map(({ id, label }) => {
            const selected = draft.models.roles[id];
            return (
              <Field key={id}>
                <FieldLabel htmlFor={`role-${id}`}>{label}</FieldLabel>
                <Select
                  value={selections[id]}
                  onValueChange={(value) => {
                    if (value === selections[id]) return;
                    setSelections({ ...selections, [id]: value });
                    const next = { ...draft.models.roles };
                    if (value === "__default__") delete next[id];
                    else next[id] = value === customValue ? "" : value;
                    setDraft({ ...draft, models: { ...draft.models, roles: next } });
                  }}
                  disabled={save.isPending}
                >
                  <SelectTrigger id={`role-${id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__default__">Use default model</SelectItem>
                      {choices.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                      <SelectItem value={customValue}>Enter a different model</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {selected !== undefined && (
                  <>
                    <FieldLabel htmlFor={`custom-${id}`} className="sr-only">
                      {label} model ID
                    </FieldLabel>
                    <Input
                      id={`custom-${id}`}
                      value={selected}
                      onChange={(event) => {
                        setSelections({ ...selections, [id]: customValue });
                        setDraft({
                          ...draft,
                          models: { ...draft.models, roles: { ...draft.models.roles, [id]: event.target.value } },
                        });
                      }}
                      placeholder="provider/model"
                      required
                      disabled={save.isPending}
                    />
                  </>
                )}
              </Field>
            );
          })}
        </FieldGroup>
      )}
      {(draft.models.roles.checker || draft.models.default) === (draft.models.roles.writer || draft.models.default) && (
        <Alert>
          <AlertTitle>Choose a separate checker</AlertTitle>
          <AlertDescription>
            The writer and fact checker currently use the same model. Choose a different checker under Advanced before
            making a resume.
          </AlertDescription>
        </Alert>
      )}
      {settings.warnings.length > 0 && (
        <Alert>
          <AlertTitle>Model guidance</AlertTitle>
          <AlertDescription>
            {settings.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Settings could not be saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={save.isPending} className="h-11 w-fit">
        {save.isPending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
export default function SettingsPage() {
  const query = useSettings();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Your models, your way of working.</p>
      </div>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <PageError error={query.error} retry={() => void query.refetch()} />
      ) : (
        <SettingsForm settings={query.data} />
      )}
    </div>
  );
}
