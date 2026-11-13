const externalFactPattern = "(https?:\\/\\/|#\\d+|\\b[A-Z][A-Z0-9]+-\\d+\\b)";

const copyNodePrefixes = [
  "Literal:not([regex])[value=",
  "TemplateElement[value.raw=",
  "JSXText[value=",
];
const copyGuardSelectors = copyNodePrefixes.map((prefix) => ({
  selector: `${prefix}/\u{2014}| \u{2013} |(^|[^-\\w])-{2}($|[^-\\w])/]`,
  message:
    "No em dashes, spaced en dashes, or double hyphens in copy. Use a comma, period, colon, or rephrase.",
}));
const panelIdentityBan = [
  {
    selector:
      "JSXOpeningElement[name.name='iframe'] > JSXAttribute[name.name='key']",
    message: "PANEL-03: never key the terminal iframe (docs/ARCHITECTURE.md).",
  },
  {
    selector:
      "JSXOpeningElement[name.name=/^(DetailPanelView|DetailPanelContainer|PanelFrame|TerminalRegion)$/] > JSXAttribute[name.name='key']",
    message:
      "PANEL-03: a key on the panel ancestry remounts the terminal iframe.",
  },
  {
    selector:
      "JSXOpeningElement[name.name='iframe']:not(:has(JSXAttribute[name.name='sandbox'][value.value='allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox']))",
    message: "PANEL-03: the terminal iframe sandbox value is locked (U3-07).",
  },
];
const retiredLiteralBan = [
  ...copyNodePrefixes.map((prefix) => ({
    selector: `${prefix}/0 0 0 2px var\\(--accent\\)/]`,
    message:
      "Do not draw keyboard focus with an accent box-shadow. Use the outline focus classes (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
  ...copyNodePrefixes.map((prefix) => ({
    selector: `${prefix}/0 6px 16px rgba\\(0, ?0, ?0, ?0?\\.45\\)/]`,
    message:
      "Do not write the float shadow value. It lives once in src/web/styles/tokens.css as --shadow-float (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
  ...[
    "Property:matches([key.name='fontWeight'],[key.value='fontWeight']) > Literal[value=800]",
    "Property:matches([key.name='fontWeight'],[key.value='fontWeight']) > :matches(TSAsExpression, TSSatisfiesExpression) > Literal[value=800]",
  ].map((selector) => ({
    selector,
    message:
      "Do not write font weight 800. Use the Wordmark component or a --weight-* token (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
];
const globalSyntax = [
  ...copyGuardSelectors,
  ...panelIdentityBan,
  ...retiredLiteralBan,
];
const styleBan = [
  {
    selector: 'JSXAttribute[name.name="style"]',
    message:
      "Do not use the JSX style prop. Use Tailwind token classes (docs/standards/frontend-architecture.md, The only-shadcn rule).",
  },
];
const hexBan = copyNodePrefixes.map((prefix) => ({
  selector: `${prefix}/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]`,
  message:
    "Do not write a hex colour. Add a token to src/web/styles/tokens.css and use its Tailwind token class (docs/standards/frontend-architecture.md, The only-shadcn rule).",
}));
const fetchBan = [
  'CallExpression[callee.name="fetch"]',
  'NewExpression[callee.name="EventSource"]',
].map((selector) => ({
  selector,
  message:
    "Only query files call fetch or create an EventSource (docs/standards/frontend-architecture.md, Import matrix).",
}));
const radixBan = {
  group: ["@radix-ui/*", "radix-ui", "radix-ui/*"],
  message:
    "Import Radix only in components/ui. Compose the shadcn primitive (docs/standards/frontend-architecture.md, The only-shadcn rule).",
};
const httpBan = {
  regex: "(^|/)lib/http(\\.[cm]?[jt]sx?)?$",
  message:
    "Only query files import src/web/lib/http.ts (docs/standards/frontend-architecture.md, Layer definitions).",
};
const queryBan = {
  group: ["@tanstack/react-query"],
  message:
    "Import TanStack Query only in query files, containers and src/web/queries/, and in a route only as a type. Views, components, hooks and domain files never import it (docs/standards/frontend-architecture.md, Layer definitions).",
};
const routerBan = {
  group: ["@tanstack/react-router"],
  message:
    "Import TanStack Router only in routes, views and containers. Components and domain files never import it (docs/standards/frontend-architecture.md, Layer definitions).",
};
const reactBan = {
  regex: "^react(-dom)?(/.*)?$",
  message:
    "Keep src/web/lib free of React. Put a React hook in components/ui/hooks/ (docs/standards/frontend-architecture.md, Shared tiers).",
};
const designLiteralBan = [
  ...copyNodePrefixes.map((prefix) => ({
    selector: `${prefix}/shadow-\\[/]`,
    message:
      "Do not write an arbitrary shadow class. Use a shadow token class such as shadow-lg or shadow-(--shadow-float) (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
  ...copyNodePrefixes.map((prefix) => ({
    selector: `${prefix}/font-(extrabold|\\[800\\])/]`,
    message:
      "Do not write a weight 800 class. Use font-normal, font-medium or font-semibold (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
];
const boardZoneBan = [
  ...copyNodePrefixes.map((prefix) => ({
    selector: `${prefix}/reading-surface/]`,
    message:
      "Do not use the reading-surface class in the board module. Board cards keep the global --line-body (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
  ...[
    ...copyNodePrefixes.map((prefix) => `${prefix}/--line-body\\s*:/]`),
    "Property[key.value='--line-body']",
  ].map((selector) => ({
    selector,
    message:
      "Do not redefine --line-body in the board module. Read var(--line-body) only (docs/ARCHITECTURE.md#design-system-invariants).",
  })),
];
const selectorBan = [
  {
    selector:
      'CallExpression[callee.name="useAppStore"] > ArrowFunctionExpression[body.type=/^(?:ObjectExpression|ArrayExpression)$/]',
    message:
      "Select one stored field or a primitive from useAppStore. A selector that builds an object or array returns a new value on every read and loops useSyncExternalStore (src/web/components/ui/hooks/use-app-store.ts).",
  },
];
const newTreeSyntax = [...styleBan, ...hexBan, ...fetchBan, ...selectorBan];
const newTreeZones = [
  {
    files: ["src/web/**/*.{ts,tsx}"],
    excludeFiles: ["src/web/terminal-main.ts"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan, queryBan, routerBan],
  },
  {
    files: ["src/web/main.tsx"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan],
  },
  {
    files: ["src/web/lib/**/*.ts"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan, queryBan, routerBan, reactBan],
  },
  {
    files: ["src/web/lib/query-client.ts"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan, routerBan, reactBan],
  },
  {
    files: ["src/web/lib/http.ts"],
    syntax: [...styleBan, ...hexBan],
    imports: [radixBan, queryBan, routerBan, reactBan],
  },
  {
    files: ["src/web/routes/**/*.{ts,tsx}"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan, { ...queryBan, allowTypeImports: true }],
  },
  {
    files: ["src/web/modules/*/views/**/*.{ts,tsx}"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan, queryBan],
  },
  {
    files: ["src/web/modules/*/containers/**/*.{ts,tsx}"],
    syntax: newTreeSyntax,
    imports: [radixBan, httpBan],
  },
  {
    files: ["src/web/modules/*/components/dnd/**/*.{ts,tsx}"],
    syntax: [...hexBan, ...fetchBan, ...selectorBan],
    imports: [radixBan, httpBan, queryBan, routerBan],
  },
  {
    files: ["src/web/modules/*/queries/**/*.{ts,tsx}"],
    syntax: [...styleBan, ...hexBan],
    imports: [radixBan, routerBan],
  },
  {
    files: ["src/web/components/ui/**/*.{ts,tsx}"],
    syntax: [...hexBan, ...fetchBan, ...selectorBan],
    imports: [httpBan, queryBan, routerBan],
  },
  {
    files: ["src/web/queries/**/*.{ts,tsx}"],
    syntax: [...styleBan, ...hexBan],
    imports: [radixBan, routerBan],
  },
  {
    files: ["src/web/viewer/**/*.{ts,tsx}", "src/web/viewer-main.tsx"],
    syntax: hexBan,
    imports: [radixBan, httpBan, queryBan, routerBan],
  },
];

const chokepointMessage =
  "Route subprocess calls through adapters/exec.ts (the chokepoint), see the exec-chokepoint rulings in docs/standards/architecture.md.";

const sharedRules = {
  "eslint/no-cond-assign": ["error", "except-parens"],
  "eslint/no-constant-binary-expression": "error",
  "eslint/no-constant-condition": [
    "error",
    { checkLoops: "allExceptWhileTrue" },
  ],
  "eslint/no-empty-pattern": [
    "error",
    { allowObjectPatternsAsParameters: false },
  ],
  "eslint/no-extra-boolean-cast": "error",
  "eslint/no-fallthrough": [
    "error",
    { allowEmptyCase: false, reportUnusedFallthroughComment: false },
  ],
  "eslint/no-global-assign": "error",
  "eslint/no-invalid-regexp": "error",
  "eslint/no-irregular-whitespace": [
    "error",
    {
      skipComments: false,
      skipJSXText: false,
      skipRegExps: false,
      skipStrings: true,
      skipTemplates: false,
    },
  ],
  "eslint/no-misleading-character-class": "error",
  "eslint/no-self-assign": ["error", { props: true }],
  "eslint/no-shadow-restricted-names": ["error", { reportGlobalThis: true }],
  "eslint/no-unsafe-optional-chaining": "error",
  "eslint/no-useless-escape": "error",
  "eslint/use-isnan": [
    "error",
    { enforceForIndexOf: false, enforceForSwitchCase: true },
  ],
  "eslint/valid-typeof": ["error", { requireStringLiterals: false }],
  "eslint/for-direction": "error",
  "eslint/no-async-promise-executor": "error",
  "eslint/no-case-declarations": "error",
  "eslint/no-compare-neg-zero": "error",
  "eslint/no-control-regex": "error",
  "eslint/no-debugger": "error",
  "eslint/no-delete-var": "error",
  "eslint/no-dupe-else-if": "error",
  "eslint/no-duplicate-case": "error",
  "eslint/no-empty-character-class": "error",
  "eslint/no-empty-static-block": "error",
  "eslint/no-ex-assign": "error",
  "eslint/no-loss-of-precision": "error",
  "eslint/no-nonoctal-decimal-escape": "error",
  "eslint/no-prototype-builtins": "error",
  "eslint/no-regex-spaces": "error",
  "eslint/no-sparse-arrays": "error",
  "eslint/no-unassigned-vars": "error",
  "eslint/no-unsafe-finally": "error",
  "eslint/no-unused-labels": "error",
  "eslint/no-unused-private-class-members": "error",
  "eslint/no-useless-assignment": "error",
  "eslint/no-useless-backreference": "error",
  "eslint/no-useless-catch": "error",
  "eslint/preserve-caught-error": ["error", { requireCatchParameter: false }],
  "eslint/require-yield": "error",
  "eslint/no-array-constructor": "error",
  "eslint/no-unused-expressions": [
    "error",
    {
      allowShortCircuit: false,
      allowTaggedTemplates: false,
      allowTernary: false,
    },
  ],
  "eslint/no-unused-vars": [
    "error",
    {
      vars: "all",
      args: "after-used",
      caughtErrors: "all",
      ignoreRestSiblings: false,
    },
  ],
  "typescript/ban-ts-comment": "error",
  "typescript/no-duplicate-enum-values": "error",
  "typescript/no-empty-object-type": "error",
  "typescript/no-explicit-any": "error",
  "typescript/no-extra-non-null-assertion": "error",
  "typescript/no-misused-new": "error",
  "typescript/no-namespace": "error",
  "typescript/no-non-null-asserted-optional-chain": "error",
  "typescript/no-require-imports": "error",
  "typescript/no-this-alias": "error",
  "typescript/no-unnecessary-type-constraint": "error",
  "typescript/no-unsafe-declaration-merging": "error",
  "typescript/no-unsafe-function-type": "error",
  "typescript/no-wrapper-object-types": "error",
  "typescript/prefer-as-const": "error",
  "typescript/prefer-namespace-keyword": "error",
  "typescript/triple-slash-reference": "error",
};

const jsExtensionRules = {
  "eslint/constructor-super": "error",
  "eslint/getter-return": ["error", { allowImplicit: false }],
  "eslint/no-class-assign": "error",
  "eslint/no-const-assign": "error",
  "eslint/no-dupe-class-members": "error",
  "eslint/no-dupe-keys": "error",
  "eslint/no-empty": ["error", { allowEmptyCatch: false }],
  "eslint/no-func-assign": "error",
  "eslint/no-import-assign": "error",
  "eslint/no-new-native-nonconstructor": "error",
  "eslint/no-obj-calls": "error",
  "eslint/no-redeclare": ["error", { builtinGlobals: true }],
  "eslint/no-setter-return": "error",
  "eslint/no-this-before-super": "error",
  "eslint/no-undef": ["error", { typeof: false }],
  "eslint/no-unreachable": "error",
  "eslint/no-unsafe-negation": [
    "error",
    { enforceForOrderingRelations: false },
  ],
  "eslint/no-with": "error",
};

const tsExtensionRules = {
  "eslint/no-empty": ["error", { allowEmptyCatch: false }],
  "eslint/no-var": "error",
  "eslint/prefer-const": [
    "error",
    { destructuring: "any", ignoreReadBeforeAssign: false },
  ],
  "eslint/prefer-rest-params": "error",
  "eslint/prefer-spread": "error",
};

const typedRules = {
  "typescript/await-thenable": "error",
  "typescript/no-array-delete": "error",
  "typescript/no-base-to-string": "error",
  "typescript/no-duplicate-type-constituents": "error",
  "typescript/no-floating-promises": "error",
  "typescript/no-for-in-array": "error",
  "typescript/no-implied-eval": "error",
  "typescript/no-misused-promises": "error",
  "typescript/no-redundant-type-constituents": "error",
  "typescript/no-unnecessary-type-assertion": "error",
  "typescript/no-unsafe-argument": "error",
  "typescript/no-unsafe-assignment": "error",
  "typescript/no-unsafe-call": "error",
  "typescript/no-unsafe-enum-comparison": "error",
  "typescript/no-unsafe-member-access": "error",
  "typescript/no-unsafe-return": "error",
  "typescript/no-unsafe-unary-minus": "error",
  "typescript/only-throw-error": "error",
  "typescript/prefer-promise-reject-errors": "error",
  "typescript/require-await": "error",
  "typescript/restrict-plus-operands": "error",
  "typescript/restrict-template-expressions": "error",
  "typescript/unbound-method": "error",
};

export default {
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  plugins: ["eslint", "typescript"],
  jsPlugins: [
    { name: "syntax", specifier: "./eslint-local/restricted-syntax.js" },
  ],
  ignorePatterns: [
    "dist/**",
    "node_modules/**",
    "eslint.config.ts",
    "oxlint.config.ts",
    "src/web/routeTree.gen.ts",
    ".dependency-cruiser.cjs",
    "eslint-local/**",
    ".claude/worktrees/**",
    "src/web/public/**",
    ".planning/**",
    ".sandbox/**",
  ],
  rules: sharedRules,
  overrides: [
    { files: ["**/*.{js,mjs,cjs,jsx}"], rules: jsExtensionRules },
    { files: ["**/*.{ts,tsx,mts,cts}"], rules: tsExtensionRules },

    { files: ["**/*.{ts,tsx}"], rules: typedRules },

    {
      files: [".claude/**/*.{js,mjs}", "tests/**/*.mjs", "scripts/**/*.mjs"],
      env: { node: true },
    },
    {
      files: ["scripts/**/*.{js,mjs,cjs,ts,tsx}"],
      env: { node: true },
      rules: {
        ...Object.fromEntries(
          Object.keys(typedRules).map((rule) => [rule, "off"]),
        ),
        "eslint/no-empty": ["error", { allowEmptyCatch: true }],
      },
    },
    {
      files: ["scripts/terminal-appearance-e2e.mjs"],
      env: { browser: true },
    },

    {
      files: ["src/server/**/*.ts", "src/shared/**/*.ts"],
      env: { node: true },
    },
    { files: ["src/web/**/*.{ts,tsx}"], env: { browser: true } },

    {
      files: ["src/server/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            paths: [
              { name: "node:child_process", message: chokepointMessage },
              { name: "child_process", message: chokepointMessage },
            ],
          },
        ],
      },
    },
    {
      files: [
        "src/server/adapters/exec.ts",
        "src/server/adapters/ttyd.ts",
        "src/server/adapters/cloudflared.ts",
        "src/server/bootstrap/cli.ts",
      ],
      rules: { "eslint/no-restricted-imports": "off" },
    },

    {
      files: ["src/**/*.{ts,tsx}"],
      rules: { "syntax/restricted-syntax": ["error", ...globalSyntax] },
    },

    ...newTreeZones.map(({ files, excludeFiles, syntax, imports }) => ({
      files,
      excludeFiles: excludeFiles ?? [],
      rules: {
        "syntax/restricted-syntax": ["error", ...globalSyntax, ...syntax],
        "eslint/no-restricted-imports": ["error", { patterns: imports }],
      },
    })),

    {
      files: ["src/web/**/*.{ts,tsx}"],
      excludeFiles: ["src/web/components/ui/**"],
      rules: {
        "syntax/design-restricted-syntax": ["error", ...designLiteralBan],
      },
    },
    {
      files: ["src/web/modules/board/**/*.{ts,tsx}"],
      rules: {
        "syntax/design-restricted-syntax": [
          "error",
          ...designLiteralBan,
          ...boardZoneBan,
        ],
      },
    },

    {
      files: ["src/**/*.{ts,tsx}"],
      rules: {
        "eslint/no-empty": ["error", { allowEmptyCatch: true }],
        "eslint/no-inline-comments": [
          "error",
          { ignorePattern: externalFactPattern },
        ],
        "eslint/no-warning-comments": [
          "error",
          { terms: ["todo", "fixme", "xxx", "hack"], location: "anywhere" },
        ],
        "eslint/preserve-caught-error": [
          "warn",
          { requireCatchParameter: false },
        ],
        "eslint/no-useless-assignment": "warn",
      },
    },

    {
      files: ["src/**/*.{ts,tsx}"],
      rules: {
        "typescript/no-misused-promises": "warn",
        "typescript/no-unsafe-argument": "warn",
      },
    },

    {
      files: ["src/**/*.test.ts"],
      rules: { "typescript/no-floating-promises": "off" },
    },
  ],
};
