# Comment Standard

The comment-hygiene standard for `src/` TypeScript and TSX code in Dispatch. This document is the source of truth; the lint configuration (`comments-jsdoc-only` custom rule + stock ESLint rules + `eslint-plugin-jsdoc`) is written to enforce it verbatim. The comment rules (`comments-jsdoc-only`, `no-inline-comments`, `no-warning-comments`) are enforced at `error` severity and gate `npm run check`; only the `jsdoc/*` shape rules remain advisory (`warn`) because "non-obvious" is reviewer judgment.

## Principle

Comments explain **WHY** — intent, rationale, non-obvious constraints, invariants — never **WHAT** or **HOW**, which the code already states. A comment that restates the code is noise: it drifts out of sync and becomes a lie.

The code in this repo is comment-heavy with mostly genuine why/invariant rationale (tmux traps, the single-writer contract, the `⏺` marker protocol, PANEL-03). The task is not naive deletion — it is **relocation**: move each invariant to where it stays discoverable and enforceable (JSDoc `@remarks` for function-local rationale, `docs/ARCHITECTURE.md` for cross-module invariants), then strip the body comment. Nothing WHY-shaped is deleted without a home.

## Where migrated knowledge goes

| Kind of knowledge                                                                                                                                                                           | Destination                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Function/util contract — params, return, throws, side-effects                                                                                                                               | JSDoc block on the declaration (`@param`, `@returns`, `@throws`, `@remarks`)                                              |
| A single non-obvious "why" tied to one function                                                                                                                                             | JSDoc `@remarks` on that function                                                                                         |
| Cross-module invariant / protocol / trap (single-writer store, `DISPATCH_STATUS`/`⏺` marker protocol, tmux `-l` literal-send trap, PANEL-03 no-remount rule, loopback/DNS-rebinding threat model) | `docs/ARCHITECTURE.md` with a stable anchor, referenced from JSDoc via a short `@see docs/ARCHITECTURE.md#anchor` pointer |
| A subtle in-body ordering the code cannot express                                                                                                                                           | The rare in-body exception — see rule 9                                                                                   |

## The nine rules

1. **Comments explain WHY, never WHAT/HOW.** If a comment restates what the code does, delete it and let the code speak.
   _Enforcement: review; rules 2–5 make most violations structurally impossible._

2. **The only permitted comment form is a JSDoc block (`/** … */`) immediately above a function, hook, exported const, type, or util declaration.** Every other comment is a violation. In `src/web/**/*.tsx`, JSDoc is ALSO disallowed — component files carry zero comments, and component rationale homes in `docs/ARCHITECTURE.md` instead.
   _Enforcement: custom `comments-jsdoc-only` rule — allow `Block` comments whose text starts with `*` AND that immediately precede a declaration node; flag everything else. The tsx carve-out is the `allowJsdoc: false` scoping of that rule in `eslint.config.ts`._

3. **Zero comments inside function or component bodies.** No explanatory lines inside a React component's JSX or logic, no block comments between statements. If a body needs explanation, either (a) extract a well-named function or variable, (b) move the rationale to the declaration's JSDoc `@remarks`, or (c) move a cross-cutting invariant to `docs/ARCHITECTURE.md`.
   _Enforcement: custom `comments-jsdoc-only` rule — flag any comment whose range falls inside a function, arrow, or JSX body._

4. **Zero inline (same-line-as-code) comments anywhere, including JSX `{/* */}`.**
   _Enforcement: stock `no-inline-comments`. Its built-in JSX exception permits an own-line `{/* */}` inside JSX; the custom rule from rule 3 closes that gap so component bodies stay comment-free._

5. **No file-header banner comments.** A file's purpose is expressed by its path plus the JSDoc on its leading exported declaration, not a top-of-file essay. Existing header essays migrate to `docs/ARCHITECTURE.md` (module role) or the first exported symbol's JSDoc.
   _Enforcement: custom `comments-jsdoc-only` rule — flag `Line`/`Block` comments before the first import or declaration._

6. **JSDoc minimal shape — required only on NON-OBVIOUS functions; skip it when the function is self-documenting.** A JSDoc block is REQUIRED only when a function has a non-obvious contract: side-effects, throwing behavior, an invariant a caller must honor, a non-trivial param/return, or membership in a module's public surface (a route handler, an exported store method, an orchestrator step). A one-line pure util whose name and signature say everything (e.g. `function hostnameIsLocal(hostname: string): boolean`) MAY omit JSDoc. **Do not write JSDoc that only restates the signature** — an empty block or `@param {string} id The id` is a rule-1 violation. Minimal shape when present:

   ```
   /**
    * One-sentence summary of intent (what/why, not mechanics).
    * @remarks Non-obvious constraint or the WHY, only if there is one.
    * @param name — only if the name doesn't already make it obvious.
    * @returns — only if the return isn't obvious from the type/name.
    * @throws — if it can throw and a caller must care.
    */
   ```

   _Enforcement: `eslint-plugin-jsdoc` — `jsdoc/require-jsdoc` with `publicOnly` so only exported declarations are required to carry JSDoc; `jsdoc/require-description`; `jsdoc/check-param-names`; `jsdoc/no-blank-block-descriptions`; `jsdoc/no-bad-blocks`; `jsdoc/require-param` and `jsdoc/require-returns` off to avoid forcing redundant tags. Lint cannot decide "non-obvious" — that judgment stays with review._

7. **TODOs do not live in code.** No `// TODO`, `// FIXME`, `// XXX`, or `// HACK` in committed source. Actionable work becomes a Linear ticket or a line in the "Known residuals" section of `docs/ARCHITECTURE.md`.
   _Enforcement: stock `no-warning-comments` on `todo|fixme|xxx|hack` with `location: "anywhere"` at `error`, so markers inside JSDoc blocks are caught too._

8. **Style of the rare allowed JSDoc: sentence case, terminal period, present tense, imperative summary.**
   _Enforcement: `jsdoc/check-alignment` for block shape; wording style (sentence case, terminal period, tense) is review judgment. Stock `capitalized-comments` and `multiline-comment-style` are deliberately not wired — they would push line comments toward starred blocks instead of toward JSDoc-or-nothing._

9. **Exceptions — the workaround / bug-reference ruling (DECISIVE).** A **single-line** rationale is permitted _inside a body_ IF AND ONLY IF it pins an external, code-irreducible fact — a third-party bug with a URL or issue reference, a spec/protocol quirk, or a deliberately counter-intuitive ordering that a maintainer would otherwise "fix" and break. It must name the external cause, for example:

   ```ts
   // ttyd rewrites proctitle — orphan sweep must fingerprint on argv, see <url>
   ```

   General "why I wrote it this way" does NOT qualify — that goes to `@remarks`. This exception is deliberately narrow: it exists so the standard never forces you to delete a landmine warning. Expect fewer than ~5 in the whole repo.
   _Enforcement: allowlist in the custom rule and the `no-inline-comments` `ignorePattern` — a single-line comment passes when it carries a URL, a `#123` issue number, or a ticket key — plus review. A sparing, justified `// eslint-disable-next-line <rule> -- <reason>` is permitted for these residues; the trailing justification is mandatory._

## Enforcement summary

Stock ESLint cannot express "only JSDoc, nothing else" — comments are not AST nodes selectable by `no-restricted-syntax`. Rules 2, 3, and 5 therefore need a small custom flat-config rule (`Program:exit` + `sourceCode.getAllComments()`, ~20–30 lines). This is configuration, not test code, so it is allowed by the repo rule. Rules 4, 6, and 7 are covered by stock `no-inline-comments`, `no-warning-comments`, and `eslint-plugin-jsdoc`; rule 8's mechanical part is `jsdoc/check-alignment`, its wording is review. The comment-form rules (2–5, 7) are enforced at `error` and gate the build; the `jsdoc/*` shape rules stay `warn` (reviewer judgment).

| Rule                                | Mechanism                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — WHY not WHAT                    | Review (rules 2–5 make most violations impossible)                                                                                                    |
| 2 — JSDoc-only form                 | Custom `comments-jsdoc-only` rule (attachment-checked)                                                                                                |
| 3 — no body comments                | Custom `comments-jsdoc-only` rule                                                                                                                     |
| 4 — no inline comments              | Stock `no-inline-comments` + custom rule (closes JSX gap)                                                                                             |
| 5 — no header banners               | Custom `comments-jsdoc-only` rule                                                                                                                     |
| 6 — minimal JSDoc, non-obvious only | `eslint-plugin-jsdoc` (`require-jsdoc` with `publicOnly`, `require-description`, `check-param-names`, `no-blank-block-descriptions`, `no-bad-blocks`) |
| 7 — no TODOs                        | Stock `no-warning-comments` (warn on `todo`/`fixme`/`xxx`/`hack`, `location: "anywhere"` — including inside JSDoc)                                    |
| 8 — JSDoc style                     | `jsdoc/check-alignment` + review (sentence case, terminal period, tense)                                                                              |
| 9 — narrow exception                | Custom-rule / `no-inline-comments` `ignorePattern` (URL/issue token) + justified `eslint-disable-next-line` + review                                  |

This standard applies to `src/` code only. Markdown documents (including this one) are exempt.
