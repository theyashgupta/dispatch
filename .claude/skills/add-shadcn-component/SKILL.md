---
name: add-shadcn-component
description: Use for /add-shadcn-component <component>. Adds a shadcn component to src/web/components/ui/ with the outline focus, token colours, exact package pins and gallery entry.
---

# Add a shadcn component

The rules are in `docs/standards/frontend-architecture.md`, in the sections "The only-shadcn rule" and "Shared tiers".

`<component>` is the registry name of the component. Example: `dropdown-menu`.

## Procedure

1. Run the shadcn CLI:

   ```
   env -u NODE_ENV npx shadcn@latest add <component> -y
   ```

2. Run `git status --short`. Record each file that the CLI created or changed.
3. Format the new files. The CLI writes files without semicolons, so `format:check` fails on them before this step.

   ```
   env -u NODE_ENV npx prettier --write <each new file>
   ```

4. Do not write a new primitive by hand. Do not change a generated file, except with the edits in steps 5 to 17 or with a `cva` variant.

## Packages

5. Open `package.json`. The CLI adds packages to `dependencies`, for example `radix-ui`, `cn`, `cmdk` and `sonner`.
   1. Move each web package that the CLI added to `devDependencies`.
   2. Pin each moved package to an exact version. Remove each `^` and `~`.
   3. Do not move `zod` or a server package.
   4. Do not install `next-themes`, `react-hook-form` or `@hookform/resolvers`.
   5. Run `env -u NODE_ENV npm install` to update `package-lock.json`.

## Focus outline

6. In each generated file, replace each of these classes with `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`:
   - `focus-visible:ring-*`
   - `focus-visible:border-ring`
   - `ring-offset-*`
   - `aria-invalid:ring-*` and `dark:aria-invalid:ring-*`
7. Keep `aria-invalid:border-destructive`.
8. If an ancestor with `overflow: hidden` cuts the outline, use `focus-visible:outline-offset-0` at that element.
9. Run `grep -nE '(^|[^a-z-])ring-' <file>` on each generated file. The command must show no line.

## Colours

10. Replace each Tailwind default palette class with a token class. Examples: `text-white` becomes `text-on-accent` or `text-on-danger`, and `bg-black/50` becomes `bg-scrim`.
11. Replace a raw colour variable in a class, for example `hsl(var(--x))`, with `var(--x)`.
12. Open `src/web/styles/globals.css`. Remove each colour value that the CLI added, for example an `oklch()` value.
13. Map each new shadcn colour name to a token that `src/web/styles/tokens.css` defines. Do not add a shadcn name to `tokens.css`.
    1. In the `:root` block of `src/web/styles/globals.css`, add one custom property for the name. Its value is `var()` of the token. Example: `--card: var(--surface-card);`.
    2. In the `@theme inline` block of `src/web/styles/globals.css`, add the colour name. Example: `--color-card: var(--card);`.
    3. `tokens.css` already defines some names. Do not add a `:root` line for these names. Map each one in the `@theme inline` block of `src/web/styles/globals.css`:
       - `accent`: `--color-accent: var(--surface-card-hover);`
       - `destructive`: `--color-destructive: var(--destructive);`
       - `border`: `--color-border: var(--border);`
       - `radius`: `--radius-md: var(--radius);`. The `--radius-sm` and `--radius-lg` tokens in `tokens.css` set the other sizes.
14. If a token class does not exist in the `@theme inline` block of `src/web/styles/globals.css`, add its mapping there. Do not write a colour value.
15. Keep the `@custom-variant dark` line in `src/web/styles/globals.css`.

## Sonner

16. If the component is `sonner`, remove the `next-themes` import from `sonner.tsx`. Give the `Toaster` a `theme` prop that its consumer sets. Do not import a hook from outside `src/web/components/ui/`.

## Gallery

17. Add the component to `src/web/gallery-main.tsx`, in the group of its family. If this file does not exist, skip this step and tell the user.

## Checks

18. Run `env -u NODE_ENV npm run check:static`. It must pass.
19. Tell the user the new files, the moved packages and their versions.
