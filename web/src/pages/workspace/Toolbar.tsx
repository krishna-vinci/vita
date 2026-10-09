import { ChevronDown, Download, Undo2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function Toolbar({
  details,
  onDetails,
  onUndo,
  undoing,
  onPdf,
  onMarkdown,
  exporting,
  canPdf,
  prepTo,
  overBy,
  onFit,
}: {
  details: boolean;
  onDetails: (on: boolean) => void;
  onUndo: () => void;
  undoing: boolean;
  onPdf: () => void;
  onMarkdown: () => void;
  exporting: boolean;
  canPdf: boolean;
  /** Link to the interview prep, for job resumes only. */
  prepTo?: string;
  /** Page limit when the PDF is over it, to offer a one-click fit. */
  overBy?: number;
  onFit: (pages: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-h-11 items-center gap-2">
        <Switch id="show-details" checked={details} onCheckedChange={onDetails} />
        <Label htmlFor="show-details" className="cursor-pointer text-muted-foreground">
          Show details
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="h-11" onClick={onUndo} disabled={undoing}>
          <Undo2 /> Undo
        </Button>
        {overBy ? (
          <Button variant="outline" className="h-11" onClick={() => onFit(overBy)}>
            Fit to {overBy === 1 ? "one page" : `${overBy} pages`}
          </Button>
        ) : null}
        {prepTo && (
          <Button variant="outline" className="h-11" asChild>
            <Link to={prepTo}>Prepare me</Link>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-11" disabled={exporting}>
              <Download /> {exporting ? "Getting it ready…" : "Download"} <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onPdf} disabled={!canPdf}>
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMarkdown}>Markdown</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onFit(1)}>Fit to one page first</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onFit(2)}>Fit to two pages first</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
