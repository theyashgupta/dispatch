import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import jsdoc from "eslint-plugin-jsdoc";
import boundaries from "eslint-plugin-boundaries";
import checkFile from "eslint-plugin-check-file";
import prettier from "eslint-config-prettier";
import commentsJsdocOnly from "./eslint-local/comments-jsdoc-only.js";

/**
 * Shared element descriptors for both boundary blocks below (backend +
 * frontend `boundaries/dependencies` rule instances) so a file classifies
 * identically under either rule. First-match-wins: the four frontend
 * sub-elements (primitives/hooks/lib/feature) are listed BEFORE the general
 * `web` catch-all — same precedent as `adapters-subprocess` before `adapters`
 * — so files under those subtrees classify as their sub-element instead of
 * falling through to `web`. `web` remains the catch-all for
 * App.tsx/main.tsx/styles.
 *
 * The two `mode: "file"` descriptors below (`adapters-subprocess`,
 * `adapters-config-consumer`) are on a deprecated syntax path
 * (eslint-plugin-boundaries 7.x). Migrating them is deliberately deferred to
 * Phase 57, not silently dropped — a naive `partialMatch: false` swap was
 * empirically verified-broken (it stops both descriptors from matching their
 * target files, silently reclassifying exec/git/tmux/image-proxy as plain
 * `adapters` and losing the transport-narrowing these carve-outs exist to
 * enforce). The correct migration is `settings["boundaries/files"]` file
 * descriptors plus a policy rewrite; `mode: "file"` continues to function
 * correctly today (deprecation-warning-only, never blocks `npm run check`).
 * @see docs/standards/architecture.md#gap-list — `mode:"file"` element-descriptor migration
 */
const boundaryElements = [
  { type: "bootstrap", pattern: "src/server/bootstrap" },
  { type: "routes", pattern: "src/server/routes" },
  { type: "services", pattern: "src/server/services" },
  {
    type: "adapters-subprocess",
    pattern: "src/server/adapters/{exec,git,tmux}.ts",
    mode: "file",
  },
  {
    type: "adapters-config-consumer",
    pattern: "src/server/adapters/image-proxy.ts",
    mode: "file",
  },
  { type: "adapters", pattern: "src/server/adapters" },
  { type: "sources", pattern: "src/server/sources" },
  { type: "store", pattern: "src/server/store" },
  { type: "shared", pattern: "src/shared" },
  { type: "primitives", pattern: "src/web/primitives" },
  { type: "hooks", pattern: "src/web/hooks" },
  { type: "lib", pattern: "src/web/lib" },
  {
    type: "feature",
    pattern: "src/web/features/*",
    capture: ["feature"],
  },
  { type: "web", pattern: "src/web" },
];

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
 * `hasSession` liveness probe) imports directly from the tmux adapter,
 * which is legal because services may import adapters-subprocess.
 *
 * The `from`/`allow`/`disallow` lists below name the four new frontend
 * sub-elements alongside `web` so this error-level rule stays green now that
 * those sub-elements exist (AUDIT-02) — the fine-grained frontend import
 * direction is enforced separately by `feWebBoundariesConfig` below, at error
 * as of Phase 56's ENF-01 flip (with a named warn carve-out for the 3
 * Phase-57 gap edges).
 *
 * `adapters/image-proxy.ts` is a named file-mode carve-out
 * (`adapters-config-consumer`, listed BEFORE the general `adapters` element):
 * it is an adapter-tier file (external Linear-CDN I/O per
 * docs/standards/architecture.md's correction row) that reads orchestration
 * config directly from `services/infra/config-holder.ts`, unlike every other
 * adapter which receives config as an injected parameter. Phase 56's ENF-01
 * error-flip must carry this as a named allow-rule, never widen
 * `adapters -> services` generally.
 */
const boundariesConfig = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "import/resolver": { typescript: {} },
    "boundaries/elements": boundaryElements,
  },
  rules: {
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        policies: [
          {
            from: [
              "bootstrap",
              "routes",
              "services",
              "adapters",
              "adapters-subprocess",
              "adapters-config-consumer",
              "sources",
              "store",
              "shared",
            ],
            disallow: ["web", "primitives", "hooks", "lib", "feature"],
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
            allow: [
              "routes",
              "services",
              "adapters",
              "adapters-config-consumer",
              "store",
              "shared",
            ],
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
          {
            from: "adapters-config-consumer",
            allow: ["services", "shared"],
          },
          { from: "sources", allow: ["sources", "shared"] },
          { from: "store", allow: ["store", "shared"] },
          { from: "shared", allow: ["shared"] },
          {
            from: ["web", "primitives", "hooks", "lib", "feature"],
            allow: ["web", "primitives", "hooks", "lib", "feature", "shared"],
          },
        ],
      },
    ],
  },
};

/**
 * Frontend import-direction + feature entry-point policies, shared by
 * `feWebBoundariesConfig` (error) and `feWebBoundariesWarnCarveout` (warn) so
 * the two severity-split blocks can never drift apart — extracted per ENF-01
 * to keep the 7-policy options object defined exactly once.
 * `default: "allow"` is deliberate — the frontend's edges were enumerated as
 * of Phase 56's restructure, so only the explicit `disallow` policies below
 * produce findings (an unenumerated `disallow`-by-default would flag the
 * entire tree). Uses `policies` (not the deprecated `rules` alias) and
 * `{{ }}` Handlebars capture templates — the plugin's current, non-deprecated
 * syntax.
 *
 * Policy evaluation is last-write-wins: the trailing allow policies MUST stay
 * after the disallow policies or they stop overriding them. The final allow
 * encodes folder-structure.md's sanctioned `features/* -> badges` shared-leaf
 * edge (CardView.tsx's two badge deep imports produce no findings by design);
 * the same-feature allow before it is a deliberate belt-and-braces guard
 * should policy 1's negated-capture template
 * (`!{{from.captured.feature}}`) ever regress.
 */
const feWebBoundaryPolicies = {
  default: "allow",
  policies: [
    {
      from: { element: { type: "feature" } },
      disallow: {
        element: {
          type: "feature",
          captured: { feature: "!{{from.captured.feature}}" },
          fileInternalPath: "!index.ts",
        },
      },
      message:
        "Cross-feature import must go through the feature's index.ts barrel (docs/standards/folder-structure.md).",
    },
    {
      from: { element: { type: "web" } },
      disallow: {
        element: { type: "feature", fileInternalPath: "!index.ts" },
      },
      message:
        "App composes features through their index.ts barrel (docs/standards/folder-structure.md).",
    },
    {
      from: { element: { type: "primitives" } },
      disallow: {
        element: { type: ["hooks", "lib", "feature", "web"] },
      },
      message:
        "Import direction is primitives -> hooks/lib -> features -> App (docs/standards/folder-structure.md).",
    },
    {
      from: { element: { type: "hooks" } },
      disallow: { element: { type: ["feature", "web"] } },
      message:
        "Import direction is primitives -> hooks/lib -> features -> App (docs/standards/folder-structure.md).",
    },
    {
      from: { element: { type: "lib" } },
      disallow: {
        element: { type: ["primitives", "hooks", "feature", "web"] },
      },
      message:
        "Import direction is primitives -> hooks/lib -> features -> App (docs/standards/folder-structure.md).",
    },
    {
      from: { element: { type: "feature" } },
      allow: {
        element: {
          type: "feature",
          captured: { feature: "{{from.captured.feature}}" },
        },
      },
    },
    {
      from: { element: { type: "feature" } },
      allow: {
        element: { type: "feature", captured: { feature: "badges" } },
      },
    },
  ],
};

/**
 * ENF-01 error-flip: frontend import-direction + feature entry-point rules
 * now enforced at error for every `src/web/**` file. Only the 3 named
 * Phase-57 gap edges (`lib/card-badges.ts` -> `hooks/useUnseenActivity`;
 * `primitives/ActivityItem.tsx` -> `lib/event-copy`, `lib/format-age`) stay
 * at warn, via the trailing `feWebBoundariesWarnCarveout` block registered
 * immediately after this one (flat-config last-write-wins — the carve-out's
 * position in the exported array is load-bearing, not incidental).
 *
 * The `watcher -> ttyd -> store` edge produces no boundaries violation and
 * needs no allow-rule: `watcher` and `ttyd` both classify as the general
 * `adapters` element, `adapters -> store` is already allowed, and `store` has
 * no reverse edge back to `adapters` — this is a documented invariant, not an
 * unenforced gap (@see docs/ARCHITECTURE.md#preserved-import-edges). The
 * `adapters-config-consumer` (image-proxy) carve-out and the
 * `features/* -> badges` shared-leaf allow-rule above are pre-existing and
 * survive the flip unchanged.
 */
const feWebBoundariesConfig = {
  files: ["src/web/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "import/resolver": { typescript: {} },
    "boundaries/elements": boundaryElements,
  },
  rules: {
    "boundaries/dependencies": ["error", feWebBoundaryPolicies],
  },
};

/**
 * ENF-01 named warn carve-out for the 3 genuine Phase-57 gap edges
 * (`docs/standards/architecture.md`'s "Triage-derived layering-violation
 * fixes" gap-list entry): `lib/card-badges.ts` -> `hooks/useUnseenActivity`,
 * and `primitives/ActivityItem.tsx` -> `lib/event-copy` / `lib/format-age`.
 * TODO-57 fixes these by relocating/hoisting per that gap-list entry's tier
 * label; until then this block keeps them at warn instead of error. MUST be
 * registered AFTER `feWebBoundariesConfig` in the exported array —
 * flat-config resolves the winning rule severity per file from the LAST
 * matching block, so ordering is what makes the carve-out take effect. This
 * carve-out shrinks to zero in Phase 57 and is never resolved via a rule
 * suppression directive (docs/standards/comments.md rule 9 reserves that
 * escape hatch for external, code-irreducible facts, not layering debt).
 */
const feWebBoundariesWarnCarveout = {
  files: ["src/web/lib/card-badges.ts", "src/web/primitives/ActivityItem.tsx"],
  plugins: { boundaries },
  settings: {
    "import/resolver": { typescript: {} },
    "boundaries/elements": boundaryElements,
  },
  rules: {
    "boundaries/dependencies": ["warn", feWebBoundaryPolicies],
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

/**
 * Extglob kebab-case segment shared by the check-file role-suffix patterns.
 * Mirrors the plugin's built-in KEBAB_CASE exactly (leading lowercase letter
 * required) so the suffix subtrees are precisely as strict as the base block.
 */
const KEBAB = "+([a-z])*([a-z0-9])*(-+([a-z0-9]))";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "eslint.config.ts",
      "eslint-local/**",
      "scripts/**",
      ".claude/**",
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

  {
    files: ["src/web/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: ["react", "react-dom"], patterns: ["react/*", "react-dom/*"] },
      ],
    },
  },

  boundariesConfig,
  feWebBoundariesConfig,
  feWebBoundariesWarnCarveout,

  /**
   * The exec chokepoint (argv-array, no-shell) is the app's shell-injection guard; this ban
   * closes the bypass surface at build time. The allow-list is the AUDIT-01 ruling verbatim —
   * the three CARVE-OUT files plus the chokepoint itself — author narrow, never widen.
   * @see docs/standards/architecture.md#exec-chokepoint-rulings
   */
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              message:
                "Route subprocess calls through adapters/exec.ts (the chokepoint) — docs/standards/architecture.md exec-chokepoint rulings.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/server/adapters/exec.ts",
      "src/server/adapters/ttyd.ts",
      "src/server/bootstrap/ttyd-index-setup.ts",
      "src/server/bootstrap/cli.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },

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

  /**
   * File/folder naming enforcement (docs/standards/folder-structure.md):
   * PascalCase .tsx everywhere (main.tsx exempt ONLY at src/web root via the
   * root-scoped !(main) key — a nested main.tsx still fails PascalCase),
   * kebab-case .ts, kebab-case folders. Layered override blocks exist because
   * overlapping glob keys inside ONE check-file options object require ALL
   * matching patterns to pass — a hook file would fail the broad kebab key.
   * The hooks/routes/store/sources/.d.ts subtrees therefore each replace the
   * filename rule wholesale (flat-config last-match-wins); those blocks reuse
   * the check-file plugin registered once in the general block. Middle
   * extensions are validated in every block so role suffixes
   * (.route/.store/.source/.d) are checked too — a stray foo.route.ts outside
   * routes/ fails plain KEBAB_CASE.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "check-file": checkFile },
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        {
          "src/web/!(main).tsx": "PASCAL_CASE",
          "src/web/*/**/*.tsx": "PASCAL_CASE",
          "src/!(web)/**/*.tsx": "PASCAL_CASE",
          "src/**/*.ts": "KEBAB_CASE",
        },
        { ignoreMiddleExtensions: false },
      ],
      "check-file/folder-naming-convention": [
        "error",
        { "src/**/": "KEBAB_CASE" },
      ],
    },
  },
  {
    files: ["src/web/hooks/**/*.ts"],
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "src/web/hooks/**/*.ts": "use[A-Z]*([a-zA-Z0-9])" },
        { ignoreMiddleExtensions: false },
      ],
    },
  },
  {
    files: ["src/server/routes/**/*.ts"],
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "src/server/routes/**/*.ts": `${KEBAB}?(.route)` },
        { ignoreMiddleExtensions: false },
      ],
    },
  },
  {
    files: ["src/server/store/**/*.ts"],
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "src/server/store/**/*.ts": `${KEBAB}?(.store)` },
        { ignoreMiddleExtensions: false },
      ],
    },
  },
  {
    files: ["src/server/sources/**/*.ts"],
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "src/server/sources/**/*.ts": `${KEBAB}?(.source)` },
        { ignoreMiddleExtensions: false },
      ],
    },
  },
  {
    files: ["src/**/*.d.ts"],
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "src/**/*.d.ts": `${KEBAB}.d` },
        { ignoreMiddleExtensions: false },
      ],
    },
  },

  prettier,
);
