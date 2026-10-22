import type { Rules } from "@vita/shared";
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRules, useSaveRules } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUrlFlag } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const none = "none";

function Form({
  initial,
  effective,
  locked,
  hash,
}: {
  initial: Rules;
  effective: Rules;
  locked: boolean;
  hash: string | null;
}) {
  const save = useSaveRules();
  // Open state is in the URL (?rules-advanced=1), so a reload or Back keeps it.
  const [advanced, setAdvanced] = useUrlFlag("rules-advanced");
  const [pages, setPages] = useState(String(initial.max_pages));
  const [honesty, setHonesty] = useState<Rules["honesty"]>(initial.honesty ?? "balanced");
  const [fill, setFill] = useState(String(Math.round(initial.min_fill * 100)));
  const [chars, setChars] = useState(initial.max_bullet_chars ? String(initial.max_bullet_chars) : "");
  const [banned, setBanned] = useState((initial.banned_phrases ?? []).join("\n"));
  const [required, setRequired] = useState((initial.required_sections ?? []).join("\n"));
  const [order, setOrder] = useState((initial.section_order ?? []).join("\n"));
  const [date, setDate] = useState<string>(initial.date_format ?? none);
  const [locale, setLocale] = useState<string>(initial.locale ?? none);
  const submit = () => {
    const rules = {
      honesty,
      max_pages: Number(pages) || 1,
      min_fill: (Number(fill) || 85) / 100,
      ...(Number(chars) > 0 ? { max_bullet_chars: Number(chars) } : {}),
      ...(lines(banned).length ? { banned_phrases: lines(banned) } : {}),
      ...(lines(required).length ? { required_sections: lines(required) } : {}),
      ...(lines(order).length ? { section_order: lines(order) } : {}),
      ...(date !== none ? { date_format: date as Rules["date_format"] } : {}),
      ...(locale !== none ? { locale: locale as Rules["locale"] } : {}),
    };
    save.mutate(
      { rules, baseHash: hash },
      { onSuccess: () => toast.success("Rules saved."), onError: (error) => toast.error(error.message) },
    );
  };
  const differs = JSON.stringify(effective) !== JSON.stringify(initial);
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {(locked || differs) && (
        <Alert>
          <Lock aria-hidden="true" />
          <AlertDescription>
            <p>
              <strong>Some rules are set by whoever runs this server.</strong> The stricter rule always wins. In effect
              now: up to {effective.max_pages} {effective.max_pages === 1 ? "page" : "pages"}
              {effective.max_bullet_chars ? `, lines up to ${effective.max_bullet_chars} characters` : ""}
              {effective.date_format ? `, dates like ${effective.date_format}` : ""}.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-pages">Page limit</Label>
          <Input
            id="rule-pages"
            type="number"
            min={1}
            max={4}
            value={pages}
            onChange={(event) => setPages(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-fill">Fill at least (% of page)</Label>
          <Input
            id="rule-fill"
            type="number"
            min={50}
            max={100}
            value={fill}
            onChange={(event) => setFill(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-chars">Longest line (characters)</Label>
          <Input
            id="rule-chars"
            type="number"
            min={1}
            value={chars}
            onChange={(event) => setChars(event.target.value)}
            placeholder="No limit set"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-date">Date style</Label>
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger id="rule-date" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={none}>Leave as written</SelectItem>
              <SelectItem value="MMM YYYY">Mar 2024</SelectItem>
              <SelectItem value="MM/YYYY">03/2024</SelectItem>
              <SelectItem value="YYYY">2024</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-locale">Spelling</Label>
          <Select value={locale} onValueChange={setLocale}>
            <SelectTrigger id="rule-locale" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={none}>No preference</SelectItem>
              <SelectItem value="en-US">American English</SelectItem>
              <SelectItem value="en-GB">British English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {(
        [
          ["rule-banned", "Words and phrases to avoid", banned, setBanned, "One per line"],
          ["rule-required", "Sections every resume needs", required, setRequired, "One per line, like Experience"],
          ["rule-order", "Order of sections", order, setOrder, "One per line, top first"],
        ] as const
      ).map(([id, label, value, set, hint]) => (
        <div key={id} className="flex flex-col gap-2">
          <Label htmlFor={id}>{label}</Label>
          <Textarea
            id={id}
            value={value}
            onChange={(event) => set(event.target.value)}
            placeholder={hint}
            className="min-h-20"
          />
        </div>
      ))}
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          className="-ml-3 h-11 w-fit gap-2"
          aria-expanded={advanced}
          aria-controls="rules-advanced-body"
          onClick={() => setAdvanced(!advanced)}
        >
          Advanced
          <ChevronDown
            className={cn("transition-transform motion-reduce:transition-none", advanced && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
        <div id="rules-advanced-body" hidden={!advanced} className="flex flex-col gap-2">
          <Label htmlFor="rule-honesty">How strict</Label>
          <Select value={honesty} onValueChange={(value) => setHonesty(value as Rules["honesty"])}>
            <SelectTrigger id="rule-honesty" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balanced">Balanced: your word counts, links and details need no proof</SelectItem>
              <SelectItem value="strict">Strict: every claim needs a source receipt</SelectItem>
              <SelectItem value="trust">Trust me: checks only warn, never block</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Nothing is ever invented. Balanced records what you tell Vita as &ldquo;you said&rdquo;.
          </p>
        </div>
      </div>
      <Button type="submit" className="h-11 w-fit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save rules"}
      </Button>
    </form>
  );
}

export function RulesForm() {
  const query = useRules();
  return (
    <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
      <h3 id="rules-heading" className="font-display text-lg font-medium">
        Rules
      </h3>
      <p className="max-w-2xl text-sm text-muted-foreground">Simple limits Vita checks on every resume.</p>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <PageError error={query.error} retry={() => void query.refetch()} />
      ) : (
        <Form
          key={query.data.hash ?? "new"}
          initial={query.data.rules}
          effective={query.data.effectiveRules}
          locked={query.data.locked}
          hash={query.data.hash}
        />
      )}
    </section>
  );
}
