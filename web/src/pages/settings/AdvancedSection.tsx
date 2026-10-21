import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUrlFlag } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { InstructionsEditor } from "./InstructionsEditor";
import { McpSection } from "./McpSection";
import { PromptViewer } from "./PromptViewer";
import { RulesForm } from "./RulesForm";

/** Closed by default. Everything here is optional. */
export function AdvancedSection() {
  // Open state is in the URL (?advanced=1), so a reload or Back keeps it.
  const [open, setOpen] = useUrlFlag("advanced");
  return (
    <section aria-labelledby="advanced-heading" className="flex flex-col gap-6">
      <h2 id="advanced-heading" className="font-display text-xl font-medium">
        <Button
          type="button"
          variant="ghost"
          className="-ml-3 h-11 gap-2 text-xl font-medium"
          aria-expanded={open}
          aria-controls="advanced-body"
          onClick={() => setOpen(!open)}
        >
          Advanced
          <ChevronDown
            className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
      </h2>
      <div id="advanced-body" hidden={!open} className="flex flex-col gap-10">
        {open && (
          <>
            <InstructionsEditor />
            <RulesForm />
            <PromptViewer />
            <McpSection />
          </>
        )}
      </div>
    </section>
  );
}
