import { ChevronDown, Download, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Toolbar({
  details,
  onDetails,
  onUndo,
  undoing,
  onPdf,
  onMarkdown,
  exporting,
  canPdf,
}: {
  details: boolean;
  onDetails: (on: boolean) => void;
  onUndo: () => void;
  undoing: boolean;
  onPdf: () => void;
  onMarkdown: () => void;
  exporting: boolean;
  canPdf: boolean;
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className="h-11 cursor-not-allowed opacity-50"
              aria-disabled="true"
              onClick={(event) => event.preventDefault()}
            >
              Prepare me
            </Button>
          </TooltipTrigger>
          <TooltipContent>Coming in the next update</TooltipContent>
        </Tooltip>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
