import { useBlocker } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Asks before in-app navigation leaves a page with unsaved work. Reload and close are guarded by the browser. */
export function LeaveGuard({ when, what = "your changes" }: { when: boolean; what?: string }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname,
  );
  return (
    <AlertDialog open={blocker.state === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved {what}. They are kept for this tab until you close it, but they are not saved yet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" className="h-11">
              Stay
            </Button>
          </AlertDialogCancel>
          <Button className="h-11" onClick={() => blocker.proceed?.()}>
            Leave
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The small note shown when unsaved text came back after a reload. */
export function RestoredNote({ onDiscard }: { onDiscard: () => void }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      Restored your unsaved changes.
      <Button type="button" variant="link" className="h-auto p-0" onClick={onDiscard}>
        Discard
      </Button>
    </p>
  );
}
