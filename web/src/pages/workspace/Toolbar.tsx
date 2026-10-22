import { ChevronDown, Download, Eye, MoreHorizontal, Palette, ScrollText, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Toolbar({
  details,
  onDetails,
  onUndo,
  undoing,
  onPdf,
  onMarkdown,
  exporting,
  canPdf,
  overBy,
  onFit,
  onTemplate,
  onEditLatex,
  onStyle,
  onInstructions,
  onPreview,
}: {
  details: boolean;
  onDetails: (on: boolean) => void;
  onUndo: () => void;
  undoing: boolean;
  onPdf: () => void;
  onMarkdown: () => void;
  exporting: boolean;
  canPdf: boolean;
  /** Page limit when the PDF is over it, to offer a one-click fit. */
  overBy?: number;
  onFit: (pages: number) => void;
  onTemplate: () => void;
  /** Absent for the master resume, which has no LaTeX edits. */
  onEditLatex?: () => void;
  onStyle: () => void;
  onInstructions: () => void;
  /** Only below the width where the preview sits beside the resume. */
  onPreview?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
      <div className="flex items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          className="h-11 max-sm:w-11 max-sm:px-0"
          onClick={onInstructions}
          aria-label="Instructions"
        >
          <ScrollText /> <span className="max-sm:hidden">Instructions</span>
        </Button>
        <Button variant="ghost" className="h-11 max-sm:w-11 max-sm:px-0" onClick={onStyle} aria-label="Style">
          <Palette /> <span className="max-sm:hidden">Style</span>
        </Button>
        <Button
          variant="ghost"
          className="h-11 max-sm:w-11 max-sm:px-0"
          onClick={onUndo}
          disabled={undoing}
          aria-label="Undo"
        >
          <Undo2 /> <span className="max-sm:hidden">Undo</span>
        </Button>
        {onPreview && (
          <Button variant="ghost" className="h-11 max-sm:w-11 max-sm:px-0" onClick={onPreview} aria-label="Preview">
            <Eye /> <span className="max-sm:hidden">Preview</span>
          </Button>
        )}
        {overBy ? (
          <Button variant="outline" className="h-11" onClick={() => onFit(overBy)}>
            Fit to {overBy === 1 ? "one page" : `${overBy} pages`}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="h-11 max-sm:w-11 max-sm:px-0"
              variant="default"
              disabled={exporting}
              aria-label={exporting ? "Getting it ready…" : "Download"}
            >
              <MoreHorizontal className="sm:hidden" />
              <span className="flex items-center gap-2 max-sm:hidden">
                <Download /> {exporting ? "Getting it ready…" : "Download"} <ChevronDown />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onPdf} disabled={!canPdf}>
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMarkdown}>Markdown</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onTemplate}>Change template…</DropdownMenuItem>
            {onEditLatex && <DropdownMenuItem onSelect={onEditLatex}>Edit LaTeX…</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => onFit(1)}>Fit to one page first</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onFit(2)}>Fit to two pages first</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={details} onCheckedChange={onDetails}>
              Show sources and checks
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
