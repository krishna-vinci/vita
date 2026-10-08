import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Flag } from "@/lib/resume-view";
import type { SheetActions } from "./types";

/** The soft highlight on a line, with the three honest choices. */
export function FlagPopover({
  flag,
  bulletId,
  text,
  actions,
  children,
}: {
  flag: Flag;
  bulletId: string;
  text: string;
  actions: SheetActions;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [vouching, setVouching] = useState(false);
  const [note, setNote] = useState("");
  const isNumber = flag.kind === "number" && flag.raw;
  const done = () => {
    setOpen(false);
    setVouching(false);
    setNote("");
  };
  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : done())}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="start">
        <div className="flex flex-col gap-3">
          <p className="font-display text-base font-medium">
            {isNumber ? `Where does "${flag.raw}" come from?` : "Can you stand behind this line?"}
          </p>
          <p className="text-muted-foreground">{flag.reason}</p>
          {vouching ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                actions.vouch(bulletId, note.trim());
                done();
              }}
            >
              <Label htmlFor={`vouch-${bulletId}`}>
                {isNumber ? "How did you measure it?" : "What backs this up?"}
              </Label>
              <Input
                id={`vouch-${bulletId}`}
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="A short note, only you will see it"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={!note.trim()}>
                  Keep it
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setVouching(false)}>
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col items-stretch gap-2">
              <Button size="sm" variant="outline" onClick={() => setVouching(true)}>
                {isNumber ? "I measured it" : "Yes, this is accurate"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  actions.ask(
                    isNumber
                      ? `Say this line without the number "${flag.raw}", and keep it true to my notes: "${text}"`
                      : `Reword this line so it says only what my notes support: "${text}"`,
                  );
                  done();
                }}
              >
                {isNumber ? "Say it without the number" : "Say it more carefully"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  actions.hide(bulletId, true);
                  done();
                }}
              >
                Remove line
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
