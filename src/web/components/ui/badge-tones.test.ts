import test from "node:test";
import assert from "node:assert/strict";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { badgeVariants } from "./badge.js";
import { alertVariants } from "./alert.js";

type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

const classes = (value: string): string[] => value.split(/\s+/);

test("each Badge tone selects the legacy Chip token classes", () => {
  const expected: Record<Tone, string[]> = {
    neutral: ["border-border", "bg-transparent", "text-muted-foreground"],
    accent: [
      "bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-card))]",
      "text-(--accent-text)",
    ],
    success: [
      "bg-[color-mix(in_srgb,var(--status-ok)_16%,var(--surface-card))]",
      "text-(--status-ok)",
    ],
    warning: [
      "bg-[color-mix(in_srgb,var(--status-stale)_16%,var(--surface-card))]",
      "text-(--status-stale)",
    ],
    danger: [
      "bg-[color-mix(in_srgb,var(--destructive)_16%,var(--surface-card))]",
      "text-destructive-text",
    ],
    state: [
      "bg-[color-mix(in_srgb,var(--badge-state)_12%,transparent)]",
      "text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))]",
      "before:bg-(--badge-state)",
    ],
  };
  for (const tone of Object.keys(expected) as Tone[]) {
    const got = classes(badgeVariants({ variant: null, tone }));
    for (const token of expected[tone]) {
      assert.ok(got.includes(token), `${tone} lacks ${token}`);
    }
    assert.ok(!got.includes("bg-primary"), `${tone} keeps the default fill`);
  }
});

test("the Badge base carries the legacy chip shape and the outline focus", () => {
  const got = classes(badgeVariants());
  for (const token of [
    "h-4.5",
    "px-1",
    "rounded-sm",
    "text-xs",
    "font-semibold",
    "focus-visible:outline-2",
    "focus-visible:outline-offset-2",
    "focus-visible:outline-ring",
  ]) {
    assert.ok(got.includes(token), `base lacks ${token}`);
  }
});

test("the destructive Badge uses the danger fill and its label token", () => {
  const got = classes(badgeVariants({ variant: "destructive" }));
  assert.ok(got.includes("bg-destructive-fill"));
  assert.ok(got.includes("text-on-danger"));
});

test("each Alert variant selects the legacy Notice token classes", () => {
  const muted = classes(alertVariants({ variant: "muted" }));
  assert.ok(muted.includes("text-muted-foreground"));
  assert.ok(muted.includes("*:data-[slot=alert-description]:text-foreground"));
  assert.ok(muted.includes("bg-transparent"));

  const destructive = classes(alertVariants({ variant: "destructive" }));
  assert.ok(destructive.includes("text-destructive-text"));
  assert.ok(
    destructive.includes(
      "*:data-[slot=alert-description]:text-destructive-text",
    ),
  );
  assert.ok(!destructive.includes("text-destructive"));

  assert.ok(classes(alertVariants()).includes("bg-card"));
});

test("the merged Badge tones keep border-transparent unless the tone sets a border", () => {
  for (const tone of [
    "accent",
    "success",
    "warning",
    "danger",
    "state",
  ] as const) {
    const merged = classes(cn(badgeVariants({ variant: null, tone })));
    assert.ok(
      merged.includes("border-transparent"),
      `${tone} lost its transparent border`,
    );
    assert.ok(
      !merged.includes("border-border"),
      `${tone} gained a visible border`,
    );
  }
  const neutral = classes(
    cn(badgeVariants({ variant: null, tone: "neutral" })),
  );
  assert.ok(neutral.includes("border-border"));
  assert.ok(!neutral.includes("border-transparent"));
});

test("the merged Alert variants replace the default padding", () => {
  for (const variant of ["muted", "destructive"] as const) {
    const merged = classes(cn(alertVariants({ variant })));
    assert.ok(
      merged.includes("px-0") && merged.includes("py-0"),
      `${variant} lacks px-0 py-0`,
    );
    assert.ok(
      !merged.includes("px-4") && !merged.includes("py-3"),
      `${variant} keeps the default padding`,
    );
    assert.ok(merged.includes("border-transparent"));
  }
  const fallback = classes(cn(alertVariants()));
  assert.ok(fallback.includes("px-4") && fallback.includes("py-3"));
});
