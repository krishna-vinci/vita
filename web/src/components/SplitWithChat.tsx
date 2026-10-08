import { MessageSquareText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Content with a chat panel: a side column on wide screens, a bottom sheet on phones. */
export function SplitWithChat({ children, chat }: { children: React.ReactNode; chat: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">{children}</div>
      <aside className="sticky top-6 hidden h-[calc(100dvh-6rem)] rounded-xl border bg-card p-4 lg:flex lg:flex-col">
        {chat}
      </aside>
      <Button
        className="fixed right-4 bottom-20 z-30 h-12 rounded-full shadow-lg lg:hidden"
        onClick={() => setOpen(true)}
      >
        <MessageSquareText /> Ask for a change
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[80dvh] gap-2 p-4">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Chat</SheetTitle>
            <SheetDescription className="sr-only">Ask for changes in plain words.</SheetDescription>
          </SheetHeader>
          {chat}
        </SheetContent>
      </Sheet>
    </div>
  );
}
