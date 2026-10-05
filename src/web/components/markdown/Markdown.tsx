import { useMemo, type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isLinearUploadUrl } from "../../../shared/linear-asset-url.js";
import { ImageWithFallback } from "@/components/icons/ImageWithFallback";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { isHttpSrc } from "@/components/markdown/web-src";

interface MarkdownProps {
  source: string;
  attachmentBase?: string;
}

const block = "m-0 mb-(--space-sm)!";
const heading = "mx-0 mt-(--space-lg)! mb-(--space-sm)! font-semibold";
const minorHeading = cn(
  heading,
  "text-sm leading-(--line-label) text-muted-foreground",
);
const text = "text-base text-foreground";
const link = "text-(--accent-text) underline";
const cell = "border border-border px-2 py-1 text-(length:--font-label)";

const ALIGN: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function alignOf(style: CSSProperties | undefined): string {
  return ALIGN[style?.textAlign ?? "left"] ?? "text-left";
}

function renderImage(src: unknown, alt: string | undefined, base?: string) {
  if (typeof src !== "string" || src === "") return <>{alt}</>;
  const label = alt != null && alt !== "" ? alt : undefined;
  if (base !== undefined && src.startsWith("attachments/")) {
    return (
      <ImageWithFallback
        key={src}
        src={`${base}/${src.slice("attachments/".length)}`}
        alt={label}
      />
    );
  }
  if (isLinearUploadUrl(src)) {
    return (
      <ImageWithFallback
        key={src}
        src={`/api/images?url=${encodeURIComponent(src)}`}
        alt={label}
      />
    );
  }
  if (!isHttpSrc(src)) return <>{label ?? src}</>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className={link}>
      {label ?? src}
    </a>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1
      className={cn(
        heading,
        "text-(length:--font-md-h1) leading-(--line-heading) text-foreground",
      )}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className={cn(heading, text, "leading-(--line-heading)")}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      className={cn(
        heading,
        "text-base leading-(--line-label) text-muted-foreground",
      )}
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => <h4 className={minorHeading}>{children}</h4>,
  h5: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h6: ({ children }) => <h6 className={minorHeading}>{children}</h6>,
  p: ({ children }) => (
    <p className={cn(block, text, "wrap-anywhere [word-break:break-word]")}>
      {children}
    </p>
  ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        block,
        className?.includes("contains-task-list")
          ? "list-none pl-1"
          : "list-disc pl-5",
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className={cn(block, "list-decimal pl-5")}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className={cn(text, "mb-(--space-xs)")}>{children}</li>
  ),
  a: ({ href, children }) =>
    href != null && /^mailto:/i.test(href) ? (
      <a href={href} className={link}>
        {children}
      </a>
    ) : href != null && isHttpSrc(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
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
      className="mt-0.75 mr-1.5 mb-0.75 ml-1 size-3.25 align-middle disabled:cursor-default [&_svg]:size-2.5"
    />
  ),
  pre: ({ children }) => (
    <pre
      className={cn(
        block,
        "overflow-x-auto rounded-md border border-border bg-card px-3 py-2 font-mono",
      )}
    >
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code
      className={cn(
        "font-mono text-(length:--font-label)",
        typeof children === "string" && children.includes("\n")
          ? "border-none bg-transparent p-0"
          : "rounded-(--radius-sm) border border-border bg-card px-1 py-0.5 text-foreground",
      )}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className={cn(block, "overflow-x-auto")}>
      <table className="m-0 w-max min-w-full border-collapse">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th className={cn(cell, "bg-card font-semibold", alignOf(style))}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className={cn(cell, alignOf(style))}>{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className={cn(
        block,
        "border-l-2 border-border pl-3 text-muted-foreground",
      )}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="mx-0 my-(--space-lg)! h-0 border-0 border-t border-border" />
  ),
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
