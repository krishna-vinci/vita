import { Plus, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPeriod, type HighlightRow, type LinkRow, newKey, parsePeriod } from "./info-model";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
    </Field>
  );
}

/** Start and end as month and year, or "Ongoing". Whatever is stored stays readable: "2023–2026" opens as 2023 and 2026. */
export function DatesField({ id, value, onChange }: { id: string; value: string; onChange: (period: string) => void }) {
  const dates = parsePeriod(value);
  const change = (patch: Partial<typeof dates>) => onChange(formatPeriod({ ...dates, ...patch }));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Dates</legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
            From (month and year)
          </Label>
          <Input
            id={id}
            value={dates.start}
            onChange={(event) => change({ start: event.target.value })}
            placeholder="Mar 2024"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${id}-end`} className="text-xs font-normal text-muted-foreground">
            To (month and year)
          </Label>
          <Input
            id={`${id}-end`}
            value={dates.end}
            disabled={dates.ongoing}
            onChange={(event) => change({ end: event.target.value })}
            placeholder={dates.ongoing ? "Ongoing" : "Jun 2025"}
            autoComplete="off"
          />
        </div>
        <div className="flex h-11 items-center gap-2 sm:h-9">
          <Checkbox
            id={`${id}-ongoing`}
            checked={dates.ongoing}
            onCheckedChange={(checked) => change({ ongoing: checked === true, end: "" })}
          />
          <Label htmlFor={`${id}-ongoing`} className="font-normal">
            Ongoing
          </Label>
        </div>
      </div>
    </fieldset>
  );
}

/** Words that become chips: Enter or comma adds one, Backspace on an empty box removes the last. */
export function TagsInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [text, setText] = useState("");
  const commit = (raw: string) => {
    const additions = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part && !values.some((value) => value.toLowerCase() === part.toLowerCase()));
    if (additions.length) onChange([...values, ...additions]);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(text);
    } else if (event.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
  };
  return (
    <Field id={id} label={label} hint={hint}>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {values.map((value) => (
            <li key={value}>
              <Badge variant="secondary" className="h-7 gap-1 pr-1 text-sm">
                {value}
                <button
                  type="button"
                  className="grid size-5 place-content-center rounded-full hover:bg-background/60"
                  aria-label={`Remove ${value}`}
                  onClick={() => onChange(values.filter((item) => item !== value))}
                >
                  <X />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(text)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </Field>
  );
}

/** "What you did": one line per bullet. Existing bullets keep their id, so Vita still knows which one you edited. */
export function HighlightsEditor({
  idPrefix,
  rows,
  onChange,
}: {
  idPrefix: string;
  rows: HighlightRow[];
  onChange: (rows: HighlightRow[]) => void;
}) {
  const hintId = useId();
  const focusKey = useRef<string | null>(null);
  const update = (k: string, text: string) => onChange(rows.map((row) => (row.k === k ? { ...row, text } : row)));
  const add = (after?: number) => {
    const row = { k: newKey(), text: "" };
    focusKey.current = row.k;
    const at = after === undefined ? rows.length : after + 1;
    onChange([...rows.slice(0, at), row, ...rows.slice(at)]);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">What you did</legend>
      <p id={hintId} className="text-sm text-muted-foreground">
        Start with an action: Built, Led, Cut…
      </p>
      {rows.map((row, index) => (
        <div key={row.k} className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-highlight-${index}`}
            aria-label={`What you did ${index + 1}`}
            aria-describedby={hintId}
            ref={(element) => {
              if (element && focusKey.current === row.k) {
                focusKey.current = null;
                element.focus();
              }
            }}
            value={row.text}
            onChange={(event) => update(row.k, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(index);
              }
            }}
            placeholder="Cut page load time by moving the feed filter to a background job"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Remove bullet ${index + 1}`}
            onClick={() => onChange(rows.filter((item) => item.k !== row.k))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" className="h-11" onClick={() => add()}>
          <Plus /> Add a bullet
        </Button>
      </div>
    </fieldset>
  );
}

export function LinksEditor({
  idPrefix,
  rows,
  onChange,
}: {
  idPrefix: string;
  rows: LinkRow[];
  onChange: (rows: LinkRow[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Links</legend>
      {rows.map((row, index) => (
        <div key={row.k} className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-link-${index}`}
            aria-label={`Link ${index + 1}`}
            value={row.text}
            onChange={(event) =>
              onChange(rows.map((item) => (item.k === row.k ? { ...item, text: event.target.value } : item)))
            }
            placeholder="github.com/you/project"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Remove link ${index + 1}`}
            onClick={() => onChange(rows.filter((item) => item.k !== row.k))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => onChange([...rows, { k: newKey(), text: "" }])}
        >
          <Plus /> Add a link
        </Button>
      </div>
    </fieldset>
  );
}
