/**
 * Local ESLint flat-config plugin enforcing the repo comment standard
 * (docs/standards/comments.md): the only permitted comment form is a JSDoc
 * block immediately above a declaration; line and plain-block comments are
 * violations, and components must carry zero comments.
 *
 * @remarks JSDoc shape alone is not enough — a block passes only when it
 * immediately precedes a declaration node outside any function body (rules 2,
 * 3, and 5). Directive comments (eslint/global pragmas and TypeScript
 * triple-slash references) are exempted so the tooling stays usable; drop the
 * pragma exemption if the standard later forbids inline disables. Rule 9's
 * narrow escape hatch is honored: a single-line comment carrying a URL,
 * issue number, or ticket key (an external, code-irreducible fact) passes. The
 * rule is configured at `error` severity in eslint.config.ts and gates the build.
 */
const ATTACHABLE_TYPES = new Set([
  "FunctionDeclaration",
  "TSDeclareFunction",
  "ClassDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "VariableDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "MethodDefinition",
  "PropertyDefinition",
  "TSMethodSignature",
  "TSPropertySignature",
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Comment-standard rule 9 escape hatch: a single-line comment pinning an
 * external, code-irreducible fact is allowed if it carries a URL, an issue
 * number, or a ticket key.
 */
const EXTERNAL_FACT_TOKEN = /(https?:\/\/|#\d+|\b[A-Z][A-Z0-9]+-\d+\b)/;

/**
 * Decides whether a JSDoc-shaped block comment is attached: its next token
 * starts a declaration on the line immediately below, and that declaration
 * does not sit inside a function body.
 */
function isAttachedJsdoc(sourceCode, comment) {
  const next = sourceCode.getTokenAfter(comment, { includeComments: false });
  if (!next || next.loc.start.line > comment.loc.end.line + 1) return false;
  let node = sourceCode.getNodeByRangeIndex(next.range[0]);
  let attached = null;
  while (node && node.range[0] === next.range[0]) {
    if (ATTACHABLE_TYPES.has(node.type)) attached = node;
    node = node.parent;
  }
  if (!attached) return false;
  for (let ancestor = attached.parent; ancestor; ancestor = ancestor.parent) {
    if (FUNCTION_TYPES.has(ancestor.type)) return false;
  }
  return true;
}

const rule = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { allowJsdoc: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allowJsdoc = context.options[0]?.allowJsdoc !== false;
    const sc = context.sourceCode;
    return {
      "Program:exit"() {
        for (const c of sc.getAllComments()) {
          if (c.type === "Hashbang" || c.type === "Shebang") continue;
          if (/^\s*eslint\b|^\s*global\b/.test(c.value)) continue;
          if (c.type === "Line" && /^\/\s*<reference\b/.test(c.value)) continue;
          if (c.type === "Line" && EXTERNAL_FACT_TOKEN.test(c.value)) continue;
          const isJsdoc = c.type === "Block" && c.value.startsWith("*");
          if (isJsdoc && allowJsdoc) {
            if (isAttachedJsdoc(sc, c)) continue;
            context.report({
              loc: c.loc,
              message:
                "JSDoc blocks are only allowed immediately above a declaration; no in-body or floating JSDoc.",
            });
            continue;
          }
          context.report({
            loc: c.loc,
            message: allowJsdoc
              ? "Only JSDoc (/** */) comments are allowed; no line or plain-block comments."
              : "Components must contain zero comments.",
          });
        }
      },
    };
  },
};

export default { rules: { "comments-jsdoc-only": rule } };
