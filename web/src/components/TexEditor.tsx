import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

export interface TexEditorHandle {
  /** Insert text at the cursor (replacing any selection) and focus the editor. */
  insert(text: string): void;
  focus(): void;
}

export interface TexEditorProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
  /** 1-based line numbers to mark with a gutter dot and a background. */
  errorLines?: number[];
  /** Called on Ctrl/Cmd+S. */
  onSave?(): void;
  height?: string;
  ariaLabel: string;
  ref?: Ref<TexEditorHandle>;
}

const setErrorLines = StateEffect.define<number[]>();
const errorField = StateField.define<number[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setErrorLines)) return effect.value;
    return value;
  },
});
const errorLineBackground = Decoration.line({ class: "cm-error-line" });
const errorBackgrounds = EditorView.decorations.compute([errorField, "doc"], (state): DecorationSet => {
  const total = state.doc.lines;
  const lines = [...new Set(state.field(errorField))]
    .filter((line) => line >= 1 && line <= total)
    .sort((a, b) => a - b);
  return Decoration.set(lines.map((line) => errorLineBackground.range(state.doc.line(line).from)));
});
class ErrorDot extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-error-dot";
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", "Error on this line");
    return dot;
  }
}
const errorDot = new ErrorDot();
const errorGutter = gutter({
  class: "cm-error-gutter",
  lineMarker(view, line) {
    const number = view.state.doc.lineAt(line.from).number;
    return view.state.field(errorField).includes(number) ? errorDot : null;
  },
  lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setErrorLines))),
  initialSpacer: () => errorDot,
});

// Colours come from the app's CSS variables, so light and dark follow the app theme.
const theme = EditorView.theme({
  "&": {
    color: "var(--foreground)",
    backgroundColor: "var(--card)",
    fontSize: "13px",
    height: "100%",
  },
  "&.cm-focused": { outline: "2px solid color-mix(in srgb, var(--ring) 50%, transparent)", outlineOffset: "-1px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55", overflow: "auto" },
  ".cm-content": { caretColor: "var(--foreground)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--primary) 28%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--muted) 55%, transparent)" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--primary) 12%, var(--muted))" },
  ".cm-error-line": { backgroundColor: "color-mix(in srgb, var(--destructive) 16%, transparent)" },
  ".cm-error-gutter": { width: "14px" },
  ".cm-error-dot": {
    display: "inline-block",
    width: "8px",
    height: "8px",
    marginLeft: "3px",
    borderRadius: "9999px",
    backgroundColor: "var(--destructive)",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 30%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warning) 55%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" },
  ".cm-panels input, .cm-panels button": { font: "inherit", fontSize: "13px" },
  ".cm-panels .cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--input)",
    borderRadius: "4px",
    padding: "3px 6px",
  },
  ".cm-panels .cm-button": {
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    backgroundImage: "none",
    border: "1px solid var(--border)",
    borderRadius: "4px",
  },
  ".cm-panels label": { color: "var(--muted-foreground)" },
});
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: "var(--primary)", fontWeight: "600" },
  { tag: [tags.comment, tags.lineComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--success)" },
  { tag: [tags.atom, tags.number, tags.bool], color: "var(--warning)" },
  { tag: [tags.tagName, tags.heading, tags.typeName], color: "var(--destructive)" },
  { tag: [tags.bracket, tags.brace, tags.punctuation], color: "var(--muted-foreground)" },
  { tag: [tags.variableName, tags.attributeName], color: "var(--foreground)" },
]);

const narrow = () => typeof matchMedia === "function" && matchMedia("(max-width: 767px)").matches;

/** LaTeX source editor (CodeMirror 6). Reusable: templates and per-resume LaTeX share it. */
export default function TexEditor({
  value,
  onChange,
  readOnly = false,
  errorLines = [],
  onSave,
  height = "100%",
  ariaLabel,
  ref,
}: TexEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const editable = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const label = useRef(new Compartment());
  const initial = useRef({ value, readOnly, ariaLabel, errorLines });

  useImperativeHandle(
    ref,
    () => ({
      insert(text: string) {
        const current = view.current;
        if (!current || current.state.readOnly) return;
        current.dispatch({ ...current.state.replaceSelection(text), scrollIntoView: true, userEvent: "input" });
        current.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  useEffect(() => {
    if (!host.current) return;
    const start = initial.current;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: start.value,
        extensions: [
          lineNumbers(),
          errorGutter,
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          highlightSelectionMatches(),
          search({ top: true }),
          StreamLanguage.define(stex),
          syntaxHighlighting(highlight),
          theme,
          errorField.init(() => start.errorLines),
          errorBackgrounds,
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave?.();
                return true;
              },
            },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          editable.current.of([EditorState.readOnly.of(start.readOnly), EditorView.editable.of(!start.readOnly)]),
          wrapping.current.of(narrow() ? EditorView.lineWrapping : []),
          label.current.of(EditorView.contentAttributes.of({ "aria-label": start.ariaLabel, spellcheck: "false" })),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    const media = typeof matchMedia === "function" ? matchMedia("(max-width: 767px)") : null;
    const rewrap = () =>
      editor.dispatch({ effects: wrapping.current.reconfigure(narrow() ? EditorView.lineWrapping : []) });
    media?.addEventListener("change", rewrap);
    return () => {
      media?.removeEventListener("change", rewrap);
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({
      effects: label.current.reconfigure(
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false" }),
      ),
    });
  }, [ariaLabel]);
  const marked = errorLines.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `marked` is the stable key of `errorLines`.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const first = Math.min(...errorLines);
    const effects: StateEffect<unknown>[] = [setErrorLines.of(errorLines)];
    // Bring the first problem into view, so a failed save never leaves it off screen.
    if (first >= 1 && first <= editor.state.doc.lines)
      effects.push(EditorView.scrollIntoView(editor.state.doc.line(first).from, { y: "center" }));
    editor.dispatch({ effects });
  }, [marked]);

  return <div ref={host} style={{ height }} className="min-h-0 overflow-hidden rounded-md border bg-card" />;
}
