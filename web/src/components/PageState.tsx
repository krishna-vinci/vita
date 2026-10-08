import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4 py-8">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
export function PageError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Something needs attention</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
