import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { rehypeHeadingIds, type HeadingEntry } from "./heading-ids.js";
import "./viewer.css";

export interface ViewerDocProps {
  source: string;
  filePath: string;
  onNavigate: (path: string, fragment: string) => void;
}

function resolveRelativeMd(
  href: string,
  currentPath: string,
): { path: string; fragment: string } | null {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.startsWith("/") ||
    href.startsWith("#")
  )
    return null;
  const [pathPart, fragment = ""] = href.split("#");
  if (!/\.(md|markdown)$/i.test(pathPart)) return null;
  const dir = currentPath.slice(0, currentPath.lastIndexOf("/") + 1);
  try {
    const base = encodeURI(dir).replace(
      /[#?]/g,
      (c) => "%" + c.charCodeAt(0).toString(16),
    );
    const url = new URL(pathPart, `file://${base}`);
    return { path: decodeURIComponent(url.pathname), fragment };
  } catch {
    return null;
  }
}

const blockMargin = "0 0 var(--space-sm)";

const h1Style: CSSProperties = {
  fontSize: "var(--font-md-h1)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-heading)",
  color: "var(--text)",
  margin: "var(--space-lg) 0 var(--space-sm)",
};

const h2Style: CSSProperties = {
  fontSize: "var(--font-md-h2)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-heading)",
  color: "var(--text)",
  margin: "var(--space-lg) 0 var(--space-sm)",
};

const h3Style: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-heading)",
  color: "var(--text)",
  margin: "var(--space-lg) 0 var(--space-sm)",
};

const h4Style: CSSProperties = {
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  margin: "var(--space-lg) 0 var(--space-sm)",
};

const pStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  margin: blockMargin,
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

const ulStyle: CSSProperties = {
  margin: blockMargin,
  paddingLeft: "20px",
  listStyleType: "disc",
};

const taskListUlStyle: CSSProperties = {
  ...ulStyle,
  listStyleType: "none",
  paddingLeft: "4px",
};

const olStyle: CSSProperties = {
  margin: blockMargin,
  paddingLeft: "20px",
  listStyleType: "decimal",
};

const liStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  marginBottom: "var(--space-xs)",
};

const anchorStyle: CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
};

const inputStyle: CSSProperties = {
  accentColor: "var(--accent)",
  verticalAlign: "middle",
  cursor: "default",
  marginRight: "6px",
};

const inlineCodeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text)",
  padding: "2px 4px",
};

const codeBlockStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  background: "transparent",
  border: "none",
  padding: 0,
};

const preStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "8px 12px",
  overflowX: "auto",
  margin: blockMargin,
  fontFamily: "var(--font-mono)",
  lineHeight: "1.5",
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  margin: blockMargin,
};

const tableStyle: CSSProperties = {
  margin: 0,
  borderCollapse: "collapse",
  width: "max-content",
  minWidth: "100%",
};

const thStyle: CSSProperties = {
  padding: "4px 8px",
  border: "1px solid var(--border)",
  textAlign: "left",
  background: "var(--surface-card)",
  fontWeight: "var(--weight-semibold)",
  fontSize: "var(--font-label)",
};

const tdStyle: CSSProperties = {
  padding: "4px 8px",
  border: "1px solid var(--border)",
  fontSize: "var(--font-label)",
};

const blockquoteStyle: CSSProperties = {
  margin: blockMargin,
  paddingLeft: "12px",
  borderLeft: "2px solid var(--border)",
  color: "var(--text-muted)",
};

const hrStyle: CSSProperties = {
  border: 0,
  borderTop: "1px solid var(--border)",
  height: 0,
  margin: "var(--space-lg) 0",
};

const staticComponents: Components = {
  h1: ({ id, children }) => (
    <h1 id={id} style={h1Style}>
      {children}
    </h1>
  ),
  h2: ({ id, children }) => (
    <h2 id={id} style={h2Style}>
      {children}
    </h2>
  ),
  h3: ({ id, children }) => (
    <h3 id={id} style={h3Style}>
      {children}
    </h3>
  ),
  h4: ({ id, children }) => (
    <h4 id={id} style={h4Style}>
      {children}
    </h4>
  ),
  h5: ({ id, children }) => (
    <h5 id={id} style={h4Style}>
      {children}
    </h5>
  ),
  h6: ({ id, children }) => (
    <h6 id={id} style={h4Style}>
      {children}
    </h6>
  ),
  p: ({ children }) => <p style={pStyle}>{children}</p>,
  ul: ({ children, className }) => (
    <ul
      style={
        className?.includes("contains-task-list") ? taskListUlStyle : ulStyle
      }
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} style={olStyle}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li style={liStyle}>{children}</li>,
  img: ({ src, alt }) =>
    typeof src === "string" && src !== "" ? (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        style={anchorStyle}
      >
        {alt != null && alt !== "" ? alt : src}
      </a>
    ) : (
      <>{alt}</>
    ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked === true}
      disabled
      readOnly
      style={inputStyle}
    />
  ),
  pre: ({ children }) => <pre style={preStyle}>{children}</pre>,
  code: ({ children, className }) => (
    <code
      className={className}
      style={
        className != null && className !== "" ? codeBlockStyle : inlineCodeStyle
      }
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={{ ...thStyle, ...style }}>{children}</th>
  ),
  td: ({ children, style }) => (
    <td style={{ ...tdStyle, ...style }}>{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote style={blockquoteStyle}>{children}</blockquote>
  ),
  hr: () => <hr style={hrStyle} />,
};

export default function ViewerDoc({
  source,
  filePath,
  onNavigate,
}: ViewerDocProps) {
  const headingsRef = useRef<HeadingEntry[]>([]);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const headingIdsPlugin = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    const transform = rehypeHeadingIds((found) => {
      headingsRef.current = found;
    });
    return () => transform;
  }, []);

  useEffect(() => {
    setHeadings(headingsRef.current);
  }, [source]);

  useEffect(() => {
    const targets = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [headings]);

  const components = useMemo<Components>(
    () => ({
      ...staticComponents,
      a: ({ href, children }) => {
        if (href == null) return <span>{children}</span>;
        if (/^mailto:/i.test(href)) {
          return (
            <a href={href} style={anchorStyle}>
              {children}
            </a>
          );
        }
        if (/^https?:\/\//i.test(href)) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={anchorStyle}
            >
              {children}
            </a>
          );
        }
        if (href.startsWith("#")) {
          return (
            <a href={href} style={anchorStyle}>
              {children}
            </a>
          );
        }
        const resolved = resolveRelativeMd(href, filePath);
        if (resolved != null) {
          return (
            <a
              href={href}
              style={anchorStyle}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(resolved.path, resolved.fragment);
              }}
            >
              {children}
            </a>
          );
        }
        return <span>{children}</span>;
      },
    }),
    [filePath, onNavigate],
  );

  const showToc = headings.length >= 3;

  return (
    <div className="viewer-root">
      <div className="viewer-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[headingIdsPlugin, rehypeHighlight]}
          skipHtml
          components={components}
        >
          {source}
        </ReactMarkdown>
      </div>
      {showToc ? (
        <nav className="viewer-toc" aria-label="Table of contents">
          {headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              className="viewer-toc-entry"
              data-depth={heading.depth}
              data-active={heading.id === activeId ? "true" : undefined}
            >
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
