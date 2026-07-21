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
 * `web` catch-all so files under those subtrees classify as their sub-element
 * instead of falling through to `web`. `web` remains the catch-all for
 * App.tsx/main.tsx/styles.
 *
 * `exec.ts`/`git.ts`/`tmux.ts`/`image-proxy.ts` classify as plain `adapters`
 * here — their transport-narrowing and config-consumer carve-out are enforced
 * via `boundaryFiles`' file-category descriptors below (`settings["boundaries/files"]`),
 * not via a separate element type. This replaces the two `mode: "file"`
 * element descriptors that lived here through Phase 56 (deprecated syntax in
 * eslint-plugin-boundaries 7.x); see `boundaryFiles`'s JSDoc for why the
 * migration could not be a naive syntax swap.
 * @see docs/standards/architecture.md#gap-list — `mode:"file"` element-descriptor migration
 */
const boundaryElements = [
  { type: "bootstrap", pattern: "src/server/bootstrap" },
  { type: "routes", pattern: "src/server/routes" },
  { type: "services", pattern: "src/server/services" },
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
 * File-category descriptors (`settings["boundaries/files"]`, the
 * non-deprecated replacement for the `mode: "file"` element descriptors this
 * config used through Phase 56). A file's category is independent of its
 * element type — `exec.ts`/`git.ts`/`tmux.ts`/`image-proxy.ts` classify as
 * plain `adapters` (see `boundaryElements`) AND carry one of these
 * categories, so policies below select on `file: { categories: ... }`
 * instead of a dedicated element `type`.
 *
 * A naive `mode: "file"` -> `partialMatch: false` element-descriptor swap was
 * empirically verified-broken (56-RESEARCH.md, live-tested): it stopped both
 * descriptors from matching their target files, silently reclassifying these
 * four files as plain `adapters` with NO narrowing policy left to catch
 * them. This file-category migration is the correct replacement; the
 * narrowing/carve-out policies that key off these categories live in
 * `boundariesConfig` below (routes' subprocess disallow, the subprocess
 * self-plus-shared-only narrowing, and the config-consumer
 * services-plus-shared-only carve-out), with `checkInternals` enabled so
 * intra-`adapters` imports are actually evaluated against them.
 * @see docs/standards/architecture.md#gap-list — `mode:"file"` element-descriptor migration
 */
const boundaryFiles = [
  {
    category: "adapters-subprocess",
    pattern: "src/server/adapters/{exec,git,tmux}.ts",
  },
  {
    category: "adapters-config-consumer",
    pattern: "src/server/adapters/image-proxy.ts",
  },
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
 * The subprocess adapters (exec/git/tmux) carry the `adapters-subprocess`
 * file category (see `boundaryFiles`) so backend-design.md's transport rule —
 * routes NEVER touch exec/tmux/git directly — is ENFORCED rather than merely
 * documented: routes may still import the non-subprocess adapters the design
 * ratifies (ttyd for the terminal spawn, editors for open-editor), but any
 * routes → exec/git/tmux import is a lint error via the trailing
 * file-category disallow policy below. The one former consumer (the
 * /terminal pre-spawn `hasSession` liveness probe) imports directly from the
 * tmux adapter, which is legal because services may import any adapter
 * (including the subprocess ones).
 *
 * The `from`/`allow`/`disallow` lists below name the four new frontend
 * sub-elements alongside `web` so this error-level rule stays green now that
 * those sub-elements exist (AUDIT-02) — the fine-grained frontend import
 * direction is enforced separately by `feWebBoundariesConfig` below, at error
 * as of Phase 56's ENF-01 flip.
 *
 * `adapters/image-proxy.ts` carries the `adapters-config-consumer` file
 * category (see `boundaryFiles`) and gets a trailing allow policy below to
 * import `services`: it is an adapter-tier file (external Linear-CDN I/O per
 * docs/standards/architecture.md's correction row) that reads orchestration
 * config directly from `services/infra/config-holder.ts`, unlike every other
 * adapter which receives config as an injected parameter. Never widen the
 * general `adapters -> services` allow from this precedent — the carve-out
 * stays scoped to the file category.
 */
const boundariesConfig = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "import/resolver": { typescript: {} },
    "boundaries/elements": boundaryElements,
    "boundaries/files": boundaryFiles,
  },
  rules: {
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        // checkInternals makes the plugin evaluate imports BETWEEN files of
        // the same element (default: ignored). Without it the subprocess
        // narrowing below is unenforceable — exec/git/tmux and every other
        // adapter share the single `adapters` element, so an
        // exec.ts -> ttyd.ts import is an "internal" dependency the rule
        // would silently skip. Every element carries a self-allow policy, so
        // enabling this changes no other outcome (probe-verified).
        checkInternals: true,
        policies: [
          {
            from: [
              "bootstrap",
              "routes",
              "services",
              "adapters",
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
              "bootstrap",
              "routes",
              "services",
              "adapters",
              "sources",
              "store",
              "shared",
            ],
          },
          {
            from: "routes",
            allow: ["routes", "services", "adapters", "store", "shared"],
          },
          {
            // Deliberately disallow: transport never touches exec/tmux/git
            // directly (backend-design.md rule 4 / transport row). Trailing
            // so it overrides the general `adapters` allow above for exactly
            // the subprocess file category.
            from: "routes",
            disallow: { file: { categories: "adapters-subprocess" } },
            message:
              "Routes must not import the subprocess adapters (exec/git/tmux) directly — backend-design.md transport rule.",
          },
          {
            from: "services",
            allow: ["services", "adapters", "store", "shared"],
          },
          {
            from: "adapters",
            allow: ["adapters", "sources", "store", "shared"],
          },
          {
            // Preserves exec/git/tmux's narrower rights (self + shared only,
            // never any other adapter, sources, or store) now that they
            // classify as plain `adapters` instead of a dedicated element
            // type. Trailing so it overrides the general `adapters` allow
            // above for exactly this file category; the next policy re-allows
            // the subprocess set to import itself (last-match-wins).
            from: { file: { categories: "adapters-subprocess" } },
            disallow: { element: { type: ["adapters", "sources", "store"] } },
            message:
              "The subprocess adapters (exec/git/tmux) may only import themselves and shared — backend-design.md transport rule.",
          },
          {
            from: { file: { categories: "adapters-subprocess" } },
            allow: { file: { categories: "adapters-subprocess" } },
          },
          {
            // The image-proxy carve-out: the one adapter allowed to read
            // orchestration config directly from services/infra/config-holder.ts.
            // Its rights are exactly services + shared — the disallow strips
            // the general `adapters` allow (adapters/sources/store) it would
            // otherwise inherit, and the trailing allow restores services.
            from: { file: { categories: "adapters-config-consumer" } },
            disallow: { element: { type: ["adapters", "sources", "store"] } },
            message:
              "image-proxy may only import services (config-holder) and shared — the config-consumer carve-out stays narrow.",
          },
          {
            from: { file: { categories: "adapters-config-consumer" } },
            allow: { element: { type: "services" } },
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
 * Frontend import-direction + feature entry-point policies, used by
 * `feWebBoundariesConfig` below.
 * `default: "allow"` is deliberate — the frontend's edges were enumerated as
 * of Phase 56's restructure, so only the explicit `disallow` policies below
 * produce findings (an unenumerated `disallow`-by-default would flag the
 * entire tree). Uses `policies` (not the deprecated `rules` alias) and
 * `{{ }}` Handlebars capture templates — the plugin's current, non-deprecated
 * syntax.
 *
 * The frontend->backend disallow policy MUST be restated here even though the
 * backend block (`boundariesConfig`) also encodes it: both blocks configure
 * the same rule ID (`boundaries/dependencies`), and flat-config last-match-wins
 * replaces earlier rule entries wholesale (severity AND options) — so for
 * every `src/web/**` file this options object is the only one in effect, and
 * omitting the policy here silently disables the frontend->backend import ban.
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
      from: {
        element: { type: ["web", "primitives", "hooks", "lib", "feature"] },
      },
      disallow: {
        element: {
          type: [
            "bootstrap",
            "routes",
            "services",
            "adapters",
            "sources",
            "store",
          ],
        },
      },
      message: "Frontend must not import backend code.",
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
 * enforced at error for every `src/web/**` file. The 3 Phase-57 gap edges
 * (`lib/card-badges.ts` -> `hooks/useUnseenActivity`; `primitives/ActivityItem.tsx`
 * -> `lib/event-copy`, `lib/format-age`) that used to warrant a warn-severity
 * carve-out are gone — those files were relocated/hoisted per
 * docs/standards/architecture.md's "Triage-derived layering-violation fixes"
 * gap-list entry, so this is the only frontend `boundaries/dependencies`
 * block; there is no trailing carve-out to keep in sync.
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
            {
              name: "child_process",
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
      "src/server/adapters/dev-server.ts",
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
