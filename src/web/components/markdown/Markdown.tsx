import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageWithFallback } from "@/components/icons/ImageWithFallback";
import { cn } from "@/lib/utils";
import { isHttpSrc } from "@/components/markdown/web-src";
import { markdownImageSource } from "../../../shared/markdown-image-source.js";
import { isWebUrl } from "../../../shared/web-url.js";

interface MarkdownProps {
  source: string;
  attachmentBase?: string;
}

const BLOCK = "m-0 mb-2";
const HEADING = "m-0 mt-4 mb-2 font-semibold leading-tight";
const ANCHOR =
  "text-(--accent-text) underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const CELL = "border border-border px-2 py-1 text-sm";

const ALIGN: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function cellAlign(style: { textAlign?: string } | undefined): string {
  return (style?.textAlign && ALIGN[style.textAlign]) || "text-left";
}

function renderImage(src: unknown, alt: string | undefined, base?: string) {
  if (typeof src !== "string" || src === "") return <>{alt}</>;
  const label = alt != null && alt !== "" ? alt : undefined;
  const imageSrc = markdownImageSource(src, base);
  if (imageSrc !== null) {
    return <ImageWithFallback key={src} src={imageSrc} alt={label} />;
  }
  if (!isWebUrl(src)) return <span>{label ?? src}</span>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className={ANCHOR}>
      {label ?? src}
    </a>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className={cn(HEADING, "text-(length:--font-md-h1) text-foreground")}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className={cn(HEADING, "text-base text-foreground")}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className={cn(HEADING, "text-base text-muted-foreground")}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className={cn(HEADING, "text-sm text-muted-foreground")}>{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className={cn(HEADING, "text-sm text-muted-foreground")}>{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className={cn(HEADING, "text-sm text-muted-foreground")}>{children}</h6>
  ),
  p: ({ children }) => (
    <p
      className={cn(
        BLOCK,
        "text-base break-words wrap-anywhere text-foreground",
      )}
    >
      {children}
    </p>
  ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        BLOCK,
        className?.includes("contains-task-list")
          ? "list-none pl-1"
          : "list-disc pl-5",
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className={cn(BLOCK, "list-decimal pl-5")}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="mb-1 text-base text-foreground">{children}</li>
  ),
  a: ({ href, children }) =>
    href != null && /^mailto:/i.test(href) ? (
      <a href={href} className={ANCHOR}>
        {children}
      </a>
    ) : href != null && isHttpSrc(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={ANCHOR}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => renderImage(src, alt),
  input: ({ checked }) => (
    <Checkbox
      checked={checked === true}
      disabled
      className="mr-1.5 align-middle"
    />
  ),
  pre: ({ children }) => (
    <pre
      className={cn(
        BLOCK,
        "overflow-x-auto rounded-md border border-border bg-card px-3 py-2 font-mono",
      )}
    >
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code
      className={
        typeof children === "string" && children.includes("\n")
          ? "border-0 bg-transparent p-0 font-mono text-sm"
          : "rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-sm text-foreground"
      }
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className={cn(BLOCK, "overflow-x-auto")}>
      <table className="m-0 w-max min-w-full border-collapse">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th className={cn(CELL, "bg-card font-semibold", cellAlign(style))}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className={cn(CELL, cellAlign(style))}>{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className={cn(
        BLOCK,
        "border-l-2 border-border pl-3 text-muted-foreground",
      )}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="mx-0 my-4 h-0 border-0 border-t border-border" />,
};

function attachmentAware(base: string): Components {
  return { ...components, img: ({ src, alt }) => renderImage(src, alt, base) };
}

export function Markdown({ source, attachmentBase }: MarkdownProps) {
  const resolved = useMemo(
    () =>
      attachmentBase === undefined
        ? components
        : attachmentAware(attachmentBase),
    [attachmentBase],
  );
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={resolved}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
