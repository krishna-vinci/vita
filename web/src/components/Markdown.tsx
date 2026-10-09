import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";

const MarkdownImpl = lazy(() => import("./MarkdownImpl"));

/**
 * The one place Markdown is displayed. Sanitised (no raw HTML), links open in a new tab safely, and loaded on
 * demand. Until it loads, the plain text shows, so nothing flashes empty. Editors stay plain text.
 */
export function Markdown({ text, className, inline = false }: { text: string; className?: string; inline?: boolean }) {
  return (
    <div className={cn("min-w-0 break-words", className)}>
      <Suspense fallback={<span className="whitespace-pre-line">{text}</span>}>
        <MarkdownImpl text={text} inline={inline} />
      </Suspense>
    </div>
  );
}
