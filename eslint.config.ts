import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import jsdoc from "eslint-plugin-jsdoc";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";
import commentsJsdocOnly from "./eslint-local/comments-jsdoc-only.js";

/**
 * Boundaries mapped to the SETTLED src/ tree (Phase 11 final). The layer graph
 * follows backend-design.md's producer DAG: shared is the sink everyone may
 * import; store depends only on shared; adapters (markers/watcher, poller,
 * ttyd, editors, tmux, git, exec) may write store (rule 3 — the 5 legal
 * producer→store edges); services compose adapters + store; routes are the HTTP
 * transport above services; bootstrap is the composition root wiring all layers.
 * No backend layer may import web. Enforced as error this phase.
 *
 * The subprocess adapters (exec/git/tmux) are carved out as their own
 * `adapters-subprocess` element (listed BEFORE `adapters` — first match wins)
 * so backend-design.md's transport rule — routes NEVER touch exec/tmux/git
 * directly — is ENFORCED rather than merely documented: routes may still
 * import the non-subprocess adapters the design ratifies (ttyd for the
 * terminal spawn, editors for open-editor), but any routes → exec/git/tmux
 * import is a lint error. The one former consumer (the /terminal pre-spawn
 * `hasSession` liveness probe) now goes through the byte-equivalent
 * services/session-status.ts passthrough.
 */
const boundariesConfig = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "import/resolver": { typescript: {} },
    "boundaries/elements": [
      { type: "bootstrap", pattern: "src/server/bootstrap" },
      { type: "routes", pattern: "src/server/routes" },
      { type: "services", pattern: "src/server/services" },
      {
        type: "adapters-subprocess",
        pattern: "src/server/adapters/{exec,git,tmux}.ts",
        mode: "file",
      },
      { type: "adapters", pattern: "src/server/adapters" },
      { type: "sources", pattern: "src/server/sources" },
      { type: "store", pattern: "src/server/store" },
      { type: "shared", pattern: "src/shared" },
      { type: "web", pattern: "src/web" },
    ],
  },
  rules: {
    "boundaries/element-types": [
      "error",
      {
        default: "disallow",
        rules: [
          {
            from: [
              "bootstrap",
              "routes",
              "services",
              "adapters",
              "adapters-subprocess",
              "sources",
              "store",
              "shared",
            ],
            disallow: ["web"],
            message: "Backend must not import frontend code.",
          },
          {
            from: "bootstrap",
            allow: [
              "routes",
              "services",
              "adapters",
              "adapters-subprocess",
              "sources",
              "store",
              "shared",
            ],
          },
          {
            // Deliberately NO adapters-subprocess: transport never touches
            // exec/tmux/git directly (backend-design.md rule 4 / transport row).
            from: "routes",
            allow: ["routes", "services", "adapters", "store", "shared"],
          },
          {
            from: "services",
            allow: [
              "services",
              "adapters",
              "adapters-subprocess",
              "store",
              "shared",
            ],
          },
          {
            from: "adapters",
            allow: [
              "adapters",
              "adapters-subprocess",
              "sources",
              "store",
              "shared",
            ],
          },
          {
            from: "adapters-subprocess",
            allow: ["adapters-subprocess", "shared"],
          },
          { from: "sources", allow: ["sources", "shared"] },
          { from: "store", allow: ["store", "shared"] },
          { from: "shared", allow: ["shared"] },
          { from: "web", allow: ["web", "shared"] },
        ],
      },
    ],
  },
};

/**
 * Shared jsdoc-plugin rule set (comments.md rule 6): applied to server, shared,
 * and web non-component (.ts) files so hooks/lib code may carry the JSDoc the
 * standard permits.
 */
const jsdocRules = {
  "jsdoc/require-jsdoc": [
    "warn",
    {
      publicOnly: true,
      require: { FunctionDeclaration: true, MethodDefinition: true },
      contexts: [
        "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
      ],
    },
  ],
  "jsdoc/require-description": "warn",
  "jsdoc/no-bad-blocks": "warn",
  "jsdoc/check-alignment": "warn",
  "jsdoc/check-param-names": "warn",
  "jsdoc/no-blank-block-descriptions": "warn",
  "jsdoc/require-param": "off",
  "jsdoc/require-returns": "off",
};

/**
 * Comment-standard rule 9 escape hatch, mirrored from the custom rule: a
 * comment carrying a URL, issue number, or ticket key names an external fact
 * and is exempt from the inline-comment ban.
 */
const externalFactPattern = "(https?:\\/\\/|#\\d+|\\b[A-Z][A-Z0-9]+-\\d+\\b)";

export default tseslint.config(
  {
    ignores: [
      "src/web/dist/**",
      "node_modules/**",
      "eslint.config.ts",
      "eslint-local/**",
      "scripts/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["src/server/**/*.ts", "src/shared/**/*.ts"],
    languageOptions: { globals: globals.node },
    plugins: { jsdoc, local: commentsJsdocOnly },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      ...jsdocRules,
      "local/comments-jsdoc-only": "error",
    },
  },

  {
    files: ["src/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat.recommended,
    plugins: {
      ...reactHooks.configs.flat.recommended.plugins,
      local: commentsJsdocOnly,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  {
    files: ["src/web/**/*.tsx"],
    rules: {
      "local/comments-jsdoc-only": ["error", { allowJsdoc: false }],
    },
  },

  {
    files: ["src/web/**/*.ts"],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      ...jsdocRules,
      "local/comments-jsdoc-only": "error",
    },
  },

  boundariesConfig,

  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-inline-comments": ["error", { ignorePattern: externalFactPattern }],
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme", "xxx", "hack"], location: "anywhere" },
      ],
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
    },
  },

  prettier,
);
