import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type FactKind = "dates" | "graduation" | "results" | "other";

/** What the person has entered so far for one fact question. */
export interface FactDraft {
  fromMonth: string;
  fromYear: string;
  toMonth: string;
  toYear: string;
  ongoing: boolean;
  year: string;
  expected: boolean;
  text: string;
  skipped: boolean;
}
export const emptyFact: FactDraft = {
  fromMonth: "",
  fromYear: "",
  toMonth: "",
  toYear: "",
  ongoing: false,
  year: "",
  expected: false,
  text: "",
  skipped: false,
};

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const idPattern = /^(dates|graduation|results)\.(.+)$/;
export const resultsHint =
  "A real number or outcome, e.g. '~40 feeds polled every 10 minutes' or 'used daily by me for 6 months'. Estimates are fine and are labelled as yours.";

/** The fact questions a job asks first are told apart by their id prefix. */
export const isFactId = (id: string) => idPattern.test(id);
export function factKindOf(id: string, kind?: FactKind): FactKind {
  const match = idPattern.exec(id);
  return match ? (match[1] as FactKind) : (kind ?? "other");
}

const yearOf = (value: string) => (/^(?:19|20)\d{2}$/.test(value) ? Number(value) : undefined);
const part = (month: string, year: string) => (month ? `${month} ${year}` : year);

/** The answer string the backend expects, "skip", or `undefined` while nothing usable is entered. */
export function factAnswer(kind: FactKind, draft: FactDraft): string | undefined {
  if (draft.skipped) return "skip";
  if (kind === "dates") {
    if (!yearOf(draft.fromYear)) return undefined;
    const from = part(draft.fromMonth, draft.fromYear);
    if (draft.ongoing) return `${from} – Present`;
    return yearOf(draft.toYear) ? `${from} – ${part(draft.toMonth, draft.toYear)}` : undefined;
  }
  if (kind === "graduation")
    return yearOf(draft.year) ? `${draft.expected ? "Expected " : ""}${draft.year}` : undefined;
  const text = draft.text.trim();
  return text.length >= 12 && text.split(/\s+/).length >= 3 ? text : undefined;
}

/** A short reason the entry cannot be sent yet, or `undefined` when it can (or is skipped). */
export function factProblem(kind: FactKind, draft: FactDraft): string | undefined {
  if (factAnswer(kind, draft)) return undefined;
  if (kind === "dates") {
    if (!yearOf(draft.fromYear)) return "Pick the year you started.";
    if (!draft.ongoing && !yearOf(draft.toYear)) return "Pick the year you finished, or choose Ongoing.";
  }
  if (kind === "graduation") return "Pick a year.";
  return "Add a few words about your work.";
}

/** Whether the person has started answering (so a half-filled answer is flagged instead of dropped). */
export function factTouched(draft: FactDraft): boolean {
  return draft.skipped || !!(draft.fromYear || draft.toYear || draft.year || draft.text.trim()) || draft.ongoing;
}

const selectClass =
  "h-11 w-0 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50 md:text-sm dark:bg-input/30 dark:[&>option]:bg-popover";

function Pick({
  label,
  value,
  onChange,
  options,
  placeholder,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <select
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={selectClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => String(to - index));

/**
 * One missing-fact question: dates (from / to or Ongoing), a graduation year, or a real result in words,
 * plus Skip. Controlled: the caller keeps the draft and turns it into an answer with `factAnswer`.
 */
export function FactQuestion({
  id,
  text,
  kind,
  value,
  onChange,
  showProblem = false,
  bare = false,
  disabled = false,
}: {
  id: string;
  text: string;
  kind: FactKind;
  value: FactDraft;
  onChange: (next: FactDraft) => void;
  /** Show why the entry can't be sent yet. */
  showProblem?: boolean;
  /** No border or padding, for a parent that already has a card. */
  bare?: boolean;
  disabled?: boolean;
}) {
  const uid = useId();
  const now = new Date().getFullYear();
  const set = (patch: Partial<FactDraft>) => onChange({ ...value, ...patch });
  const problem = showProblem ? factProblem(kind, value) : undefined;
  const yearsRecent = range(1990, now + 1);
  const yearsGraduation = range(1970, now + 6);
  const hint = `${uid}-hint`;
  return (
    <fieldset
      aria-labelledby={`${uid}-title`}
      className={cn("flex min-w-0 flex-col gap-3", !bare && "rounded-xl border bg-card p-4")}
      aria-describedby={problem ? hint : undefined}
      data-fact={id}
    >
      <p id={`${uid}-title`} className="font-display text-lg leading-snug font-medium break-words">
        {text}
      </p>
      {value.skipped ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Skipped. It won't be asked again.
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => set({ skipped: false })}>
            Answer instead
          </Button>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {kind === "dates" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-12 text-sm text-muted-foreground">From</span>
                <div className="flex min-w-0 flex-1 gap-2">
                  <Pick
                    label="From month"
                    value={value.fromMonth}
                    onChange={(fromMonth) => set({ fromMonth })}
                    options={months}
                    placeholder="Month"
                  />
                  <Pick
                    label="From year"
                    value={value.fromYear}
                    onChange={(fromYear) => set({ fromYear })}
                    options={yearsRecent}
                    placeholder="Year"
                    invalid={!!problem && !yearOf(value.fromYear)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-12 text-sm text-muted-foreground">To</span>
                <div className="flex min-w-0 flex-1 gap-2">
                  <Pick
                    label="To month"
                    value={value.toMonth}
                    onChange={(toMonth) => set({ toMonth })}
                    options={months}
                    placeholder="Month"
                  />
                  <Pick
                    label="To year"
                    value={value.toYear}
                    onChange={(toYear) => set({ toYear })}
                    options={yearsRecent}
                    placeholder="Year"
                    invalid={!!problem && !value.ongoing && !yearOf(value.toYear)}
                  />
                </div>
                <Label className="flex min-h-11 basis-full cursor-pointer items-center gap-2 text-sm sm:basis-auto">
                  <Checkbox
                    checked={value.ongoing}
                    onCheckedChange={(on) => set({ ongoing: on === true })}
                    aria-label="Ongoing"
                  />
                  ✓ Ongoing
                </Label>
              </div>
            </>
          )}
          {kind === "graduation" && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-32 flex-1 sm:max-w-48">
                <Pick
                  label="Graduation year"
                  value={value.year}
                  onChange={(year) => set({ year })}
                  options={yearsGraduation}
                  placeholder="Year"
                  invalid={!!problem}
                />
              </div>
              <Label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={value.expected}
                  onCheckedChange={(on) => set({ expected: on === true })}
                  aria-label="Expected"
                />
                Expected
              </Label>
            </div>
          )}
          {(kind === "results" || kind === "other") && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Your answer"
                aria-invalid={!!problem || undefined}
                value={value.text}
                onChange={(event) => set({ text: event.target.value })}
                placeholder="e.g. ~40 feeds polled every 10 minutes"
                className="min-h-20"
                maxLength={20_000}
              />
              <p className="text-sm text-muted-foreground">{resultsHint}</p>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p id={hint} className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}
      {!value.skipped && (
        <div className="clear-both">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={disabled}
            onClick={() => set({ skipped: true })}
          >
            Skip
          </Button>
        </div>
      )}
    </fieldset>
  );
}
