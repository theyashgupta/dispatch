import { type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  source: string;
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
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-heading)",
  color: "var(--text)",
  margin: "var(--space-lg) 0 var(--space-sm)",
};

const h3Style: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
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

const blockCodeStyle: CSSProperties = {
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

const components: Components = {
  h1: ({ children }) => <h1 style={h1Style}>{children}</h1>,
  h2: ({ children }) => <h2 style={h2Style}>{children}</h2>,
  h3: ({ children }) => <h3 style={h3Style}>{children}</h3>,
  h4: ({ children }) => <h4 style={h4Style}>{children}</h4>,
  h5: ({ children }) => <h5 style={h4Style}>{children}</h5>,
  h6: ({ children }) => <h6 style={h4Style}>{children}</h6>,
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
  a: ({ href, children }) =>
    href != null && /^mailto:/i.test(href) ? (
      <a href={href} style={anchorStyle}>
        {children}
      </a>
    ) : href != null && /^https?:\/\//i.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={anchorStyle}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
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
  code: ({ children }) => (
    <code
      style={
        typeof children === "string" && children.includes("\n")
          ? blockCodeStyle
          : inlineCodeStyle
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

export function Markdown({ source }: MarkdownProps) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
