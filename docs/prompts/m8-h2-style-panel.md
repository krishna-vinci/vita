# Task: M8-H2 Style panel + small preview fixes (frontend, simple)

Work in /home/krishna/vita-worktrees/m8-h2 (branch m8-h2, based on `m8`). Do not spawn sub-agents. Never add AI attribution. Do not commit. Match the existing code style exactly and use only the existing components in `web/src/components/ui/` (select, switch, input, label, button, dialog, sheet). No new dependencies.

## Backend facts (confirm in code)
- Template options come from `TemplateSummary.meta.knobs` (`shared/src/template.ts`). Each knob is one of:
  - `{ type?: "number", min, max, default }`
  - `{ type: "enum", options: string[], default }`
  - `{ type: "color", default: "#RRGGBB" }`
  - `{ type: "bool", default: boolean }`
- `meta.reservedKnobs` may list `section_order`.
- A resume's current values are in `resume.layout`. Change them with the existing resume ops route using `{ op: "layout.set", key, value }`. The value may be a number, string, boolean, or (only for `section_order`) a string[] of section ids. See `shared/src/api.ts` ResumeOp and how `web/src/pages/workspace/FitDialog.tsx` already sends `layout.set` for numbers.

## Do exactly this
1. **New `web/src/pages/workspace/StyleDialog.tsx`**, opened from a new **Style** button in `web/src/pages/workspace/Toolbar.tsx` (beside the template or fit buttons; read `Toolbar.tsx`). It lists the current template's knobs, found by `resume.template` in the templates query:
   - `number`: the same control FitDialog uses (check it and reuse the pattern), with min and max.
   - `enum`: `Select` with readable labels. Map known keys: `font` options as-is; `link_style` as `label` → "Label", `label+icon` → "Label with ↗", `url` → "Full URL"; `footer` as `none` → "None", `page` → "Page numbers", `name+page` → "Name and page numbers"; `header_align` as Left/Centre/Right; `date_format` as-is. Otherwise title-case the option.
   - `color`: `<input type="color">` plus a hex text input, kept in sync, validated as `#RRGGBB`.
   - `bool`: `Switch` (label `icons` → "Icons").
   - Labels: `accent` → "Accent colour", `font_pt` → "Font size", `margin_in` → "Margins", `line_spread` → "Line spacing", `section_gap_pt` → "Space between sections". Otherwise title-case the key.
   - **Section order:** a list of the resume's visible sections with ↑ and ↓ buttons (no drag library), saved as `layout.set section_order`.
   - **Apply** sends all changed keys in one ops request, then closes. The workspace refetch updates the PDF. **Reset to template defaults** sends the defaults.
   - Keep FitDialog as it is (it does page fitting). If FitDialog already shows numeric knobs, the Style dialog still shows them, which is fine.
2. **`web/src/pages/workspace/ResumeSheet.tsx`:**
   - Show `resume.header.location` before the contacts in the header line, if present.
   - In `list` sections, items with a `title` and bullets render as **"Title:** a, b, c" (bold title), matching the PDF. Read how list sections render now and change only that.

## Tests
- StyleDialog renders one control per knob type, and Apply sends one ops request with the right `layout.set` values (colour string, boolean, enum, number).
- Section order ↑/↓ then Apply sends the reordered ids.
- ResumeSheet shows the location and the bold skill category.

## Checks
```
pnpm --filter @vita/web exec vitest run src/pages/workspace
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web/src/pages/workspace
```

End with: changed files, test and typecheck output, anything skipped.
