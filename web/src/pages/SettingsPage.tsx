import { PutSettingsRequest, type SettingsView } from "@vita/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAvailableModels, useSaveSettings, useSettings, useTemplates } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useUrlFlag } from "@/lib/use-url-state";
import { AdvancedSection } from "./settings/AdvancedSection";
import { ModelPicker } from "./settings/ModelPicker";
import { ModelSetupCard } from "./settings/ModelSetupCard";
import { TemplatesSection } from "./settings/TemplatesSection";
import { UsersSection } from "./settings/UsersSection";

const roles = [
  { id: "analyst", label: "Reading the job", about: "Reads the job post and works out what it asks for." },
  { id: "writer", label: "Writing the resume", about: "Writes your resume and letters." },
  { id: "checker", label: "Checking the facts", about: "Checks every line against your evidence." },
  { id: "ats-reviewer", label: "Checking the job match", about: "Checks the keywords an employer's filter looks for." },
] as const;

function SettingsForm({ settings }: { settings: SettingsView }) {
  const available = useAvailableModels();
  const models = available.data?.models ?? [];
  const [draft, setDraft] = useState<PutSettingsRequest>({ models: settings.models, template: settings.template });
  // "Models for each step" is in the URL (?steps=1), so a reload or Back keeps it open.
  const [advanced, setAdvanced] = useUrlFlag("steps");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSettings();
  const templates = useTemplates();
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = (next: PutSettingsRequest) => {
    const result = PutSettingsRequest.safeParse(next);
    if (!result.success) {
      setError("Use provider/model for each model, and a template ID with lowercase letters, numbers or hyphens.");
      return;
    }
    setError(null);
    save.mutate(result.data, {
      onSuccess: () => {
        setSaved(true);
        toast.success("Saved");
      },
      onError: (failure) => setError(failure.message),
    });
  };
  // Every change saves on its own, after a short pause so typing a custom model ID saves once.
  const change = (next: PutSettingsRequest) => {
    setDraft(next);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(next), 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    clearTimeout(timer.current);
    persist(draft);
  };
  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-8">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="default-model">Default model</FieldLabel>
          <ModelPicker
            id="default-model"
            label="Default model"
            value={draft.models.default}
            models={models}
            disabled={save.isPending}
            onChange={(value) => change({ ...draft, models: { ...draft.models, default: value ?? "" } })}
          />
          <FieldDescription>Used for every step unless you choose a different model below.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="template">Default template</FieldLabel>
          {templates.data?.length ? (
            <Select
              value={draft.template}
              onValueChange={(template) => change({ ...draft, template })}
              disabled={save.isPending}
            >
              <SelectTrigger id="template" className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([draft.template, ...templates.data.map((entry) => entry.id)])].map((id) => (
                  <SelectItem key={id} value={id}>
                    {templates.data.find((entry) => entry.id === id)?.meta.name ?? id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="template"
              value={draft.template}
              onChange={(event) => change({ ...draft, template: event.target.value })}
              required
              disabled={save.isPending}
            />
          )}
          <FieldDescription>Used for new resumes. Add your own below.</FieldDescription>
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
          {roles.map(({ id, label, about }) => (
            <Field key={id}>
              <FieldLabel htmlFor={`role-${id}`}>{label}</FieldLabel>
              <FieldDescription>{about}</FieldDescription>
              <ModelPicker
                id={`role-${id}`}
                label={label}
                allowDefault
                value={draft.models.roles[id]}
                models={models}
                disabled={save.isPending}
                onChange={(value) => {
                  const next = { ...draft.models.roles };
                  if (value === undefined) delete next[id];
                  else next[id] = value;
                  change({ ...draft, models: { ...draft.models, roles: next } });
                }}
              />
            </Field>
          ))}
        </FieldGroup>
      )}
      {(draft.models.roles.checker || draft.models.default) === (draft.models.roles.writer || draft.models.default) && (
        <p>
          <Badge variant="outline" className="border-warning text-warning">
            Use a different model for checking
          </Badge>{" "}
          <span className="text-sm text-muted-foreground">
            The writer and the checker use the same model. Pick a different one for the checker in Advanced.
          </span>
        </p>
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
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {save.isPending || !saved ? "Saving…" : "Changes save automatically."}
      </p>
    </form>
  );
}
export default function SettingsPage() {
  const query = useSettings();
  const available = useAvailableModels();
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
        <>
          {available.data && available.data.models.length === 0 && (
            <ModelSetupCard
              hints={available.data.setupHints}
              reloading={available.isFetching}
              onReload={() => {
                void available.refetch();
                void query.refetch();
              }}
            />
          )}
          <SettingsForm settings={query.data} />
          <TemplatesSection />
          <UsersSection />
          <AdvancedSection />
        </>
      )}
    </div>
  );
}
