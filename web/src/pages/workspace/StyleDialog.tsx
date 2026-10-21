import { type ApiResumeOp, type Knob, orderedSections, type Resume, type TemplateSummary } from "@vita/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { useTemplates } from "@/api/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Value = number | string | boolean;
/** Numbers and colours are kept as typed, so a half-typed value can be shown and checked before Apply. */
type Draft = Record<string, string | boolean>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const LABELS: Record<string, string> = {
  accent: "Accent colour",
  font_pt: "Font size",
  margin_in: "Margins",
  line_spread: "Line spacing",
  section_gap_pt: "Space between sections",
};
const OPTION_LABELS: Record<string, Record<string, string>> = {
  link_style: { label: "Label", "label+icon": "Label with ↗", url: "Full URL" },
  footer: { none: "None", page: "Page numbers", "name+page": "Name and page numbers" },
  header_align: { native: "Native", left: "Left", center: "Centre", right: "Right" },
};
const AS_IS = new Set(["font", "date_format"]);

const titleCase = (text: string) => text.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const labelOf = (key: string) => LABELS[key] ?? titleCase(key);
const optionLabel = (key: string, option: string) =>
  OPTION_LABELS[key]?.[option] ?? (AS_IS.has(key) ? option : titleCase(option));

/** The value a knob has now: the resume's own value when it is valid, else the template default. */
function currentOf(knob: Knob, stored: Resume["layout"][string] | undefined): Value {
  if (knob.type === "bool") return typeof stored === "boolean" ? stored : knob.default;
  if (knob.type === "enum") return typeof stored === "string" && knob.options.includes(stored) ? stored : knob.default;
  if (knob.type === "color") return typeof stored === "string" && HEX.test(stored) ? stored : knob.default;
  return typeof stored === "number" ? stored : knob.default;
}

/** The value to send for a draft, or undefined when it is not valid for the knob. */
function parse(knob: Knob, raw: string | boolean | undefined): Value | undefined {
  if (knob.type === "bool") return typeof raw === "boolean" ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  if (knob.type === "enum") return knob.options.includes(raw) ? raw : undefined;
  if (knob.type === "color") return HEX.test(raw) ? raw : undefined;
  const number = Number(raw);
  return raw.trim() !== "" && Number.isFinite(number) && number >= knob.min && number <= knob.max ? number : undefined;
}

const draftOf = (value: Value): string | boolean => (typeof value === "boolean" ? value : String(value));

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** Style controls for the resume's template. Nothing changes until Apply, which sends one ops request. */
export function StyleDialog({
  open,
  onOpenChange,
  resume,
  applying,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resume: Resume;
  applying: boolean;
  onApply: (ops: ApiResumeOp[]) => Promise<boolean>;
}) {
  const templates = useTemplates();
  const template = templates.data?.find((entry) => entry.meta.id === resume.template);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {template ? (
          <StyleForm
            template={template}
            resume={resume}
            applying={applying}
            onApply={onApply}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>Style</DialogTitle>
            <DialogDescription>
              {templates.isError ? "The template could not be loaded." : "Loading the template…"}
            </DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StyleForm({
  template,
  resume,
  applying,
  onApply,
  onClose,
}: {
  template: TemplateSummary;
  resume: Resume;
  applying: boolean;
  onApply: (ops: ApiResumeOp[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const reserved = new Set(["section_order", ...(template.meta.reservedKnobs ?? [])]);
  const knobs = Object.entries(template.meta.knobs).filter(([key]) => !reserved.has(key));
  const current = Object.fromEntries(knobs.map(([key, knob]) => [key, currentOf(knob, resume.layout[key])]));
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(knobs.map(([key, knob]) => [key, draftOf(current[key] ?? knob.default)])),
  );
  const documentOrder = resume.sections.map((section) => section.id);
  const [order, setOrder] = useState<string[]>(() => orderedSections(resume).map((section) => section.id));
  const hidden = new Set(resume.sections.filter((section) => section.hidden).map((section) => section.id));
  const shown = order.filter((id) => !hidden.has(id));
  const titleOf = (id: string) => resume.sections.find((section) => section.id === id)?.title ?? id;
  const currentOrder = orderedSections(resume).map((section) => section.id);

  const invalid = knobs.some(([key, knob]) => parse(knob, draft[key]) === undefined);
  const set = (key: string, value: string | boolean) => setDraft((prior) => ({ ...prior, [key]: value }));
  const moveSection = (id: string, step: number) => {
    const target = shown[shown.indexOf(id) + step];
    if (!target) return;
    const next = [...order];
    const from = next.indexOf(id);
    const to = next.indexOf(target);
    [next[from], next[to]] = [next[to] ?? id, next[from] ?? target];
    setOrder(next);
  };

  /** One request with every value that differs from what the resume has now. */
  const send = async (values: Record<string, Value>, sectionOrder: string[]) => {
    const ops: ApiResumeOp[] = [];
    for (const [key] of knobs) {
      const value = values[key];
      if (value !== undefined && value !== current[key]) ops.push({ op: "layout.set", key, value });
    }
    if (!sameOrder(sectionOrder, currentOrder))
      ops.push({ op: "layout.set", key: "section_order", value: sectionOrder });
    if (!ops.length) return onClose();
    if (await onApply(ops)) onClose();
  };
  const apply = () => {
    const values: Record<string, Value> = {};
    for (const [key, knob] of knobs) {
      const value = parse(knob, draft[key]);
      if (value !== undefined) values[key] = value;
    }
    void send(values, order);
  };
  const reset = () => {
    const values = Object.fromEntries(knobs.map(([key, knob]) => [key, knob.default]));
    void send(values, documentOrder);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Style</DialogTitle>
        <DialogDescription>Changes how this resume looks in its PDF. You can undo them afterwards.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        {knobs.map(([key, knob]) => {
          const id = `style-${key}`;
          const value = draft[key];
          if (knob.type === "bool")
            return (
              <div key={key} className="flex items-center justify-between gap-3">
                <Label htmlFor={id}>{labelOf(key)}</Label>
                <Switch id={id} checked={value === true} onCheckedChange={(on) => set(key, on)} />
              </div>
            );
          if (knob.type === "enum")
            return (
              <div key={key} className="flex flex-col gap-2">
                <Label htmlFor={id}>{labelOf(key)}</Label>
                <Select value={String(value)} onValueChange={(next) => set(key, next)}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {knob.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {optionLabel(key, option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          if (knob.type === "color") {
            const text = String(value);
            return (
              <div key={key} className="flex flex-col gap-2">
                <Label htmlFor={id}>{labelOf(key)}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="color"
                    aria-label={`${labelOf(key)} picker`}
                    value={HEX.test(text) ? text.toLowerCase() : knob.default}
                    onChange={(event) => set(key, event.target.value)}
                    className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
                  />
                  <Input
                    value={text}
                    aria-label={`${labelOf(key)} hex`}
                    aria-invalid={!HEX.test(text)}
                    maxLength={7}
                    spellCheck={false}
                    className="font-mono"
                    onChange={(event) => set(key, event.target.value)}
                  />
                </div>
              </div>
            );
          }
          const range = `Between ${knob.min} and ${knob.max}`;
          return (
            <div key={key} className="flex flex-col gap-2">
              <Label htmlFor={id}>{labelOf(key)}</Label>
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step="any"
                min={knob.min}
                max={knob.max}
                value={String(value)}
                aria-invalid={parse(knob, value) === undefined}
                aria-describedby={`${id}-range`}
                onChange={(event) => set(key, event.target.value)}
              />
              <p id={`${id}-range`} className="text-xs text-muted-foreground">
                {range}
              </p>
            </div>
          );
        })}
        {shown.length > 1 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm leading-none font-medium">Section order</legend>
            <ol className="flex flex-col gap-1.5">
              {shown.map((id, index) => (
                <li key={id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1">
                  <span className="min-w-0 break-words">{titleOf(id)}</span>
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={`Move ${titleOf(id)} up`}
                      disabled={index === 0 || applying}
                      onClick={() => moveSection(id, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={`Move ${titleOf(id)} down`}
                      disabled={index === shown.length - 1 || applying}
                      onClick={() => moveSection(id, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          </fieldset>
        )}
      </div>
      <DialogFooter className="flex-wrap sm:justify-between">
        <Button variant="ghost" onClick={reset} disabled={applying}>
          Reset to template defaults
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={applying || invalid} onClick={apply}>
            Apply
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
