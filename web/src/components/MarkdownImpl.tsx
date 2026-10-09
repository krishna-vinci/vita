import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// No raw HTML is ever rendered (rehype-raw is not used) and the default sanitize schema strips anything unsafe.
const components: Components = {
  p: ({ node: _node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc pl-5 first:mt-0 last:mb-0" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal pl-5 first:mt-0 last:mb-0" {...props} />,
  li: ({ node: _node, ...props }) => <li className="my-0.5" {...props} />,
  h1: ({ node: _node, ...props }) => <h3 className="mt-3 mb-1 font-display text-base font-semibold" {...props} />,
  h2: ({ node: _node, ...props }) => <h3 className="mt-3 mb-1 font-display text-base font-semibold" {...props} />,
  h3: ({ node: _node, ...props }) => <h4 className="mt-3 mb-1 font-semibold" {...props} />,
  h4: ({ node: _node, ...props }) => <h4 className="mt-2 mb-1 font-semibold" {...props} />,
  h5: ({ node: _node, ...props }) => <h4 className="mt-2 mb-1 font-semibold" {...props} />,
  h6: ({ node: _node, ...props }) => <h4 className="mt-2 mb-1 font-semibold" {...props} />,
  a: ({ node: _node, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 break-words"
      {...props}
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...props} />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-words", className)} {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  hr: () => <hr className="my-3" />,
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th className="border-b px-2 py-1 font-medium" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b px-2 py-1 align-top" {...props} />,
  img: ({ alt }) => <span className="text-muted-foreground">{alt ? `[image: ${alt}]` : "[image]"}</span>,
};

export default function MarkdownImpl({ text, inline }: { text: string; inline?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={inline ? { ...components, p: ({ children }) => <>{children}</> } : components}
    >
      {text}
    </ReactMarkdown>
  );
}
