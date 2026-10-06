import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";

const root = path.resolve(import.meta.dirname, "..");
const web = path.join(root, "src/web");
const RULE = "boundaries/dependencies";

const fixtures: Record<string, string> = {
  "modules/fixture-a/index.ts": `export { AView } from "./views/AView";\nexport { aLabel } from "./queries/a-queries";\n`,
  "modules/fixture-a/views/AView.tsx": `import { AContainer } from "../containers/AContainer";\n\nexport function AView() {\n  return <AContainer />;\n}\n`,
  "modules/fixture-a/containers/AContainer.tsx": `import { aLabel } from "../queries/a-queries";\n\nexport function AContainer() {\n  return <p>{aLabel}</p>;\n}\n`,
  "modules/fixture-a/queries/a-queries.ts": `import { aBase } from "../domain/a-values";\n\nexport const aLabel = aBase;\n`,
  "modules/fixture-a/domain/a-values.ts": `export const aBase = "a";\n`,
  "modules/fixture-a/domain/a-derived.ts": `import { aBase } from "./a-values";\n\nexport const aDerived = aBase;\n`,
  "modules/fixture-a/hooks/use-a.ts": `import { aBase } from "../domain/a-values";\n\nexport function useA(): string {\n  return aBase;\n}\n`,
  "modules/fixture-a/components/AThing.tsx": `import { useA } from "../hooks/use-a";\n\nexport function AThing() {\n  return <p>{useA()}</p>;\n}\n`,
  "modules/fixture-a/domain/container-import.ts": `import * as target from "../containers/AContainer";\n\nexport const linked = target;\n`,
  "modules/fixture-a/views/QueryImport.tsx": `import * as target from "../queries/a-queries";\n\nexport const linked = target;\n`,
  "modules/fixture-a/components/ContainerImport.tsx": `import * as target from "../containers/AContainer";\n\nexport const linked = target;\n`,
  "modules/fixture-a/hooks/use-component-import.ts": `import * as target from "../components/AThing";\n\nexport const linked = target;\n`,
  "modules/fixture-a/components/SiblingImport.tsx": `import * as target from "@/modules/fixture-b/domain/b-values";\n\nexport const linked = target;\n`,
  "modules/fixture-a/components/FeatureImport.tsx": `import * as target from "@/features/detail";\n\nexport const linked = target;\n`,
  "modules/fixture-a/hooks/use-legacy-hook.ts": `import * as target from "@/hooks/useMediaQuery";\n\nexport const linked = target;\n`,
  "modules/fixture-a/containers/ShellImport.tsx": `import * as target from "@/App";\n\nexport const linked = target;\n`,
  "modules/fixture-a/domain/viewer-import.ts": `import * as target from "@/viewer/heading-ids";\n\nexport const linked = target;\n`,
  "modules/fixture-b/domain/b-values.ts": `export const bLabel = "b";\n`,
  "routes/BarrelRoute.tsx": `import { AView } from "@/modules/fixture-a";\n\nexport function BarrelRoute() {\n  return <AView />;\n}\n`,
  "routes/LayerRoute.tsx": `import * as target from "@/modules/fixture-a/views/AView";\n\nexport const linked = target;\n`,
  "components/ui/fixture-green.tsx": `import { cn } from "@/lib/utils";\n\nexport function FixtureGreen() {\n  return <p className={cn("a")} />;\n}\n`,
  "components/ui/fixture-red.tsx": `import * as target from "@/components/ModuleImport";\n\nexport const linked = target;\n`,
  "components/ModuleImport.tsx": `import * as target from "@/modules/fixture-a";\n\nexport const linked = target;\n`,
  "components/ui/hooks/use-fixture.ts": `export function useFixture(): number {\n  return 1;\n}\n`,
  "components/FixtureShared.tsx": `export function FixtureShared() {\n  return <p />;\n}\n`,
  "queries/fixture-queries.ts": `export const sharedLabel = "s";\n`,
  "lib/http.ts": `export const http = "h";\n`,
  "modules/fixture-a/shared-tiers.ts": `import * as t0 from "../../../shared/column-transitions";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/views/SharedTiers.tsx": `import * as t0 from "@/components/ui/fixture-green";\nimport * as t1 from "@/components/FixtureShared";\nimport * as t2 from "@/lib/utils";\nimport * as t3 from "../../../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2, t3];\n`,
  "modules/fixture-a/containers/SharedTiers.tsx": `import * as t0 from "@/components/ui/fixture-green";\nimport * as t1 from "@/components/FixtureShared";\nimport * as t2 from "@/queries/fixture-queries";\nimport * as t3 from "@/lib/utils";\nimport * as t4 from "../../../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2, t3, t4];\n`,
  "modules/fixture-a/components/SharedTiers.tsx": `import * as t0 from "@/components/ui/fixture-green";\nimport * as t1 from "@/components/FixtureShared";\nimport * as t2 from "@/lib/utils";\nimport * as t3 from "../../../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2, t3];\n`,
  "modules/fixture-a/hooks/use-shared-tiers.ts": `import * as t2 from "@/lib/utils";\nimport * as t0 from "@/components/ui/hooks/use-fixture";\nimport * as t1 from "../../../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2];\n`,
  "modules/fixture-a/queries/shared-tiers.ts": `import * as t3 from "@/lib/utils";\nimport * as t0 from "@/queries/fixture-queries";\nimport * as t1 from "@/lib/http";\nimport * as t2 from "../../../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2, t3];\n`,
  "modules/fixture-a/domain/shared-tiers.ts": `import * as t1 from "@/lib/utils";\nimport * as t0 from "../../../../shared/column-transitions";\n\nexport const linked = [t0, t1];\n`,
  "modules/fixture-a/containers/RouteImport.tsx": `import * as t0 from "@/routes/BarrelRoute";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/route-import.ts": `import * as t0 from "@/routes/BarrelRoute";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/ui-import.ts": `import * as t0 from "@/components/ui/fixture-green";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/shared-component-import.ts": `import * as t0 from "@/components/FixtureShared";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/shared-query-import.ts": `import * as t0 from "@/queries/fixture-queries";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/lib-import.ts": `import * as t0 from "@/lib/utils";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/views/SharedQueryImport.tsx": `import * as t0 from "@/queries/fixture-queries";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/views/LibImport.tsx": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/containers/LibImport.tsx": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/components/SharedQueryImport.tsx": `import * as t0 from "@/queries/fixture-queries";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/components/LibImport.tsx": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/hooks/use-ui-import.ts": `import * as t0 from "@/components/ui/fixture-green";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/hooks/use-shared-component-import.ts": `import * as t0 from "@/components/FixtureShared";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/hooks/use-shared-query-import.ts": `import * as t0 from "@/queries/fixture-queries";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/hooks/use-lib-import.ts": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/queries/ui-import.ts": `import * as t0 from "@/components/ui/fixture-green";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/queries/shared-component-import.ts": `import * as t0 from "@/components/FixtureShared";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/queries/lib-import.ts": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/domain/ui-import.ts": `import * as t0 from "@/components/ui/fixture-green";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/domain/shared-component-import.ts": `import * as t0 from "@/components/FixtureShared";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/domain/shared-query-import.ts": `import * as t0 from "@/queries/fixture-queries";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/domain/lib-import.ts": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "modules/fixture-b/index.ts": `export const bName = "b";\n`,
  "modules/fixture-a/sibling-import.ts": `import * as t0 from "@/modules/fixture-b";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/primitives-import.ts": `import * as t0 from "@/primitives/Button";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/legacy-hook-import.ts": `import * as t0 from "@/hooks/useMediaQuery";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/feature-import.ts": `import * as t0 from "@/features/detail";\n\nexport const linked = [t0];\n`,
  "modules/fixture-a/shell-import.ts": `import * as t0 from "@/App";\n\nexport const linked = [t0];\n`,
  "components/shared-tiers.ts": `import * as t0 from "@/components/ui/fixture-green";\nimport * as t1 from "@/components/ui/hooks/use-fixture";\nimport * as t2 from "@/lib/utils";\nimport * as t3 from "@/components/FixtureShared";\nimport * as t4 from "../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2, t3, t4];\n`,
  "components/shared-query-import.ts": `import * as t0 from "@/queries/fixture-queries";\n\nexport const linked = [t0];\n`,
  "components/route-import.ts": `import * as t0 from "@/routes/BarrelRoute";\n\nexport const linked = [t0];\n`,
  "components/lib-import.ts": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "components/primitives-import.ts": `import * as t0 from "@/primitives/Button";\n\nexport const linked = [t0];\n`,
  "components/legacy-hook-import.ts": `import * as t0 from "@/hooks/useMediaQuery";\n\nexport const linked = [t0];\n`,
  "components/feature-import.ts": `import * as t0 from "@/features/detail";\n\nexport const linked = [t0];\n`,
  "components/shell-import.ts": `import * as t0 from "@/App";\n\nexport const linked = [t0];\n`,
  "queries/shared-tiers.ts": `import * as t0 from "@/lib/http";\nimport * as t1 from "@/queries/fixture-queries";\nimport * as t2 from "../../shared/column-transitions";\n\nexport const linked = [t0, t1, t2];\n`,
  "queries/ui-import.ts": `import * as t0 from "@/components/ui/fixture-green";\n\nexport const linked = [t0];\n`,
  "queries/shared-component-import.ts": `import * as t0 from "@/components/FixtureShared";\n\nexport const linked = [t0];\n`,
  "queries/utils-import.ts": `import * as t0 from "@/lib/utils";\n\nexport const linked = [t0];\n`,
  "queries/lib-import.ts": `import * as t0 from "@/lib/chime";\n\nexport const linked = [t0];\n`,
  "queries/barrel-import.ts": `import * as t0 from "@/modules/fixture-a";\n\nexport const linked = [t0];\n`,
  "queries/layer-import.ts": `import * as t0 from "@/modules/fixture-a/domain/a-values";\n\nexport const linked = [t0];\n`,
  "queries/route-import.ts": `import * as t0 from "@/routes/BarrelRoute";\n\nexport const linked = [t0];\n`,
  "queries/primitives-import.ts": `import * as t0 from "@/primitives/Button";\n\nexport const linked = [t0];\n`,
  "queries/legacy-hook-import.ts": `import * as t0 from "@/hooks/useMediaQuery";\n\nexport const linked = [t0];\n`,
  "queries/feature-import.ts": `import * as t0 from "@/features/detail";\n\nexport const linked = [t0];\n`,
  "queries/shell-import.ts": `import * as t0 from "@/App";\n\nexport const linked = [t0];\n`,
  "components/ui/style-ok.tsx": `export function StyleOk() {\n  return <div style={{ width: 1 }} />;\n}\n`,
  "modules/fixture-a/components/dnd/DndStyle.tsx": `export function DndStyle() {\n  return <div style={{ width: 1 }} />;\n}\n`,
  "routes/TypeImportRoute.tsx": `import type { QueryClient } from "@tanstack/react-query";\n\nexport type Client = QueryClient;\n`,
  "modules/fixture-a/containers/QueryContainer.tsx": `import { useQuery } from "@tanstack/react-query";\nimport { Link } from "@tanstack/react-router";\n\nexport const linked = [useQuery, Link];\n`,
  "modules/fixture-a/views/RouterView.tsx": `import { Link } from "@tanstack/react-router";\n\nexport const linked = Link;\n`,
  "modules/fixture-a/queries/http-query.ts": `import { useQuery } from "@tanstack/react-query";\nimport * as http from "@/lib/http";\n\nexport const linked = [useQuery, http, fetch("/x"), new EventSource("/y")];\n`,
  "queries/shared-http.ts": `import { useQuery } from "@tanstack/react-query";\nimport * as http from "@/lib/http";\n\nexport const linked = [useQuery, http, fetch("/x"), new EventSource("/y")];\n`,
  "components/ui/radix-ok.tsx": `import * as Dialog from "@radix-ui/react-dialog";\n\nexport const linked = Dialog;\n`,
  "modules/fixture-a/components/ColorMix.tsx": `export function ColorMix() {\n  return <div className="bg-[color-mix(in_oklab,var(--accent),var(--border))]" />;\n}\n`,
  "features/fixture-legacy/LegacyStyle.tsx": `export function LegacyStyle() {\n  return <div style={{ color: "#ff0000" }} />;\n}\n`,
  "modules/fixture-a/components/InlineStyle.tsx": `export function InlineStyle() {\n  return <div style={{}} />;\n}\n`,
  "routes/HexRoute.tsx": `export const colour = "#ff0000";\n`,
  "components/ui/hex-ui.tsx": `export const colour = "#fff";\n`,
  "components/HexShared.tsx": `export function HexShared() {\n  return <p>#abcdef</p>;\n}\n`,
  "modules/fixture-a/domain/hex-template.ts": `export const colour = (alpha: string) => \`#ffffff\${alpha}\`;\n`,
  "modules/fixture-a/components/RadixImport.tsx": `import * as t0 from "@radix-ui/react-dialog";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/components/QueryComponent.tsx": `import { useQuery } from "@tanstack/react-query";\n\nexport const linked = useQuery;\n`,
  "modules/fixture-a/components/RouterComponent.tsx": `import { Link } from "@tanstack/react-router";\n\nexport const linked = Link;\n`,
  "routes/QueryValueRoute.tsx": `import { useQuery } from "@tanstack/react-query";\n\nexport const linked = useQuery;\n`,
  "modules/fixture-a/components/DashCopy.tsx": `export const copy = "one \u2014 two";\n`,
  "modules/fixture-a/components/FetchComponent.tsx": `export const linked = fetch("/x");\n`,
  "modules/fixture-a/hooks/use-event-source.ts": `export const linked = new EventSource("/y");\n`,
  "modules/fixture-a/containers/HttpContainer.tsx": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/api-barrel.ts": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/views/ApiView.tsx": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/containers/ApiContainer.tsx": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/components/ApiComponent.tsx": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/hooks/use-api.ts": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/domain/api-domain.ts": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/domain/relative-api.ts": `import * as t0 from "../../../lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/queries/api-query.ts": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "routes/ApiRoute.tsx": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "components/ui/api-ui.tsx": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "queries/api-shared.ts": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "components/ApiShared.tsx": `import * as t0 from "@/lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/http-barrel.ts": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/views/HttpView.tsx": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/components/HttpComponent.tsx": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/hooks/use-http.ts": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/domain/http-domain.ts": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "components/HttpShared.tsx": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "components/ui/http-ui.tsx": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "routes/HttpRoute.tsx": `import * as t0 from "@/lib/http";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/components/DoubleHyphen.tsx": `export const copy = "one \\u002d\\u002d two";\n`,
  "features/fixture-legacy/LegacyDash.tsx": `export const copy = "one \\u002d\\u002d two";\n`,
  "modules/fixture-a/queries/relative-api-query.ts": `import * as t0 from "../../../lib/api";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/containers/ApiSuffixContainer.tsx": `import * as t0 from "@/lib/api.js";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/components/HttpSuffixComponent.tsx": `import * as t0 from "../../../lib/http.js";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/queries/http-suffix-query.ts": `import * as t0 from "@/lib/http.js";\n\nexport const linked = t0;\n`,
  "routes/StrayRoute.tsx": `import * as t0 from "@/modules/fixture-a/shared-tiers";\n\nexport const linked = t0;\n`,
  "routes/LegacyRoute.tsx": `import * as t0 from "@/primitives/Button";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/container-barrel.ts": `import * as t0 from "./containers/AContainer";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/containers/ViewImport.tsx": `import * as t0 from "../views/AView";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/queries/component-import.ts": `import * as t0 from "../components/AThing";\n\nexport const linked = t0;\n`,
  "modules/fixture-a/views/TanstackQueryView.tsx": `import { useQuery } from "@tanstack/react-query";\n\nexport const linked = useQuery;\n`,
  "modules/fixture-a/hooks/use-tanstack-query.ts": `import { useQuery } from "@tanstack/react-query";\n\nexport const linked = useQuery;\n`,
  "modules/fixture-a/hooks/use-tanstack-router.ts": `import { Link } from "@tanstack/react-router";\n\nexport const linked = Link;\n`,
  "modules/fixture-a/queries/router-query.ts": `import { Link } from "@tanstack/react-router";\n\nexport const linked = Link;\n`,
  "../server/services/layer-fixture-red.ts": `import * as t0 from "../../web/lib/utils.js";\n\nexport const linked = t0;\n`,
  "../server/services/layer-fixture-green.ts": `import * as t0 from "./domain/errors.js";\n\nexport const linked = t0;\n`,
};

const plannedFiles = new Set(["lib/http.ts"]);
const createdFiles: string[] = [];
const createdDirs: string[] = [];

/**
 * Lists the directories that must be made for a path, outermost first.
 */
function missingDirs(dir: string): string[] {
  const missing: string[] = [];
  for (
    let current = dir;
    !fs.existsSync(current);
    current = path.dirname(current)
  )
    missing.unshift(current);
  return missing;
}

/**
 * Writes the fixtures, lints them with the repo config and removes what it wrote before any assertion runs.
 *
 * @remarks The boundaries resolver needs the imported files on disk, so virtual paths cannot work. A planned real file that already exists is used as it is and never written or deleted.
 */
async function lintFixtures(): Promise<Map<string, ESLint.LintResult>> {
  const pending = Object.entries(fixtures).filter(([rel]) => {
    const exists = fs.existsSync(path.join(web, rel));
    if (exists && !plannedFiles.has(rel))
      throw new Error(`fixture path already exists: src/web/${rel}`);
    return !exists;
  });
  try {
    for (const [rel, source] of pending) {
      const file = path.join(web, rel);
      for (const dir of missingDirs(path.dirname(file))) {
        fs.mkdirSync(dir);
        createdDirs.push(dir);
      }
      fs.writeFileSync(file, source, { flag: "wx" });
      createdFiles.push(file);
    }
    const files = Object.keys(fixtures).map((rel) => path.join(web, rel));
    const results = await new ESLint({ cwd: root }).lintFiles(files);
    return new Map(
      results.map((result) => [path.relative(web, result.filePath), result]),
    );
  } finally {
    for (const file of createdFiles) fs.rmSync(file, { force: true });
    for (const dir of [...createdDirs].reverse())
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

const results = await lintFixtures();

void test("every fixture parses and reports no rule-less message", () => {
  for (const [rel, result] of results) {
    assert.equal(result.fatalErrorCount, 0, rel);
    assert.deepEqual(
      result.messages.filter((message) => message.ruleId === null),
      [],
      rel,
    );
  }
});

/**
 * Lists the boundaries messages reported for one fixture.
 */
function boundaryMessages(rel: string): string[] {
  const result = results.get(rel);
  assert.ok(result, `no lint result for ${rel}`);
  return result.messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => message.message);
}

for (const rel of [
  "modules/fixture-a/index.ts",
  "modules/fixture-a/views/AView.tsx",
  "modules/fixture-a/containers/AContainer.tsx",
  "modules/fixture-a/components/AThing.tsx",
  "modules/fixture-a/hooks/use-a.ts",
  "modules/fixture-a/domain/a-derived.ts",
  "modules/fixture-a/queries/a-queries.ts",
  "routes/BarrelRoute.tsx",
  "routes/LegacyRoute.tsx",
  "components/ui/fixture-green.tsx",
  "modules/fixture-a/shared-tiers.ts",
  "modules/fixture-a/views/SharedTiers.tsx",
  "modules/fixture-a/containers/SharedTiers.tsx",
  "modules/fixture-a/components/SharedTiers.tsx",
  "modules/fixture-a/hooks/use-shared-tiers.ts",
  "modules/fixture-a/queries/shared-tiers.ts",
  "modules/fixture-a/domain/shared-tiers.ts",
  "components/shared-tiers.ts",
  "queries/shared-tiers.ts",
  "../server/services/layer-fixture-green.ts",
]) {
  void test(`${rel} passes ${RULE}`, () => {
    assert.deepEqual(boundaryMessages(rel), []);
  });
}

const doc = "(docs/standards/frontend-architecture.md, Import matrix).";
const legacy = `A module file does not import the legacy tree ${doc}`;
const sharedComponentRow = `A shared component imports only components/ui, src/web/lib/utils.ts, other shared components and src/shared/ ${doc}`;
const sharedQueryRow = `A shared query imports only src/web/lib/http.ts, other shared queries and src/shared/ ${doc}`;
const sibling =
  "A module does not import a sibling module. Compose modules in src/web/routes/ or a shared layout component (docs/standards/frontend-architecture.md, Import matrix).";

const barrelTiers = `A module barrel imports only these shared tiers: src/shared/ ${doc}`;
const viewTiers = `A module view file imports only these shared tiers: components/ui, shared components, src/web/lib/utils.ts, src/shared/ ${doc}`;
const containerTiers = `A module container file imports only these shared tiers: components/ui, shared components, src/web/queries/, src/web/lib/utils.ts, src/shared/ ${doc}`;
const componentTiers = `A module component file imports only these shared tiers: components/ui, shared components, src/web/lib/utils.ts, src/shared/ ${doc}`;
const hookTiers = `A module hook file imports only these shared tiers: components/ui/hooks/, src/web/lib/utils.ts, src/shared/ ${doc}`;
const queryTiers = `A module query file imports only these shared tiers: src/web/queries/, src/web/lib/http.ts, src/web/lib/utils.ts, src/shared/ ${doc}`;
const domainTiers = `A module domain file imports only these shared tiers: src/web/lib/utils.ts, src/shared/ ${doc}`;
const routeImport = `A module file does not import a route file ${doc}`;

const red: Record<string, string> = {
  "../server/services/layer-fixture-red.ts":
    "Backend must not import frontend code.",
  "routes/StrayRoute.tsx":
    "A route imports a module only through its index.ts barrel (docs/standards/frontend-architecture.md, Import matrix).",
  "modules/fixture-a/container-barrel.ts": `A module barrel imports only these layers of its own module: view, query ${doc}`,
  "modules/fixture-a/containers/ViewImport.tsx": `A module container file imports only these layers of its own module: container, component, hook, query, domain ${doc}`,
  "modules/fixture-a/queries/component-import.ts": `A module query file imports only these layers of its own module: query, domain ${doc}`,
  "modules/fixture-a/containers/RouteImport.tsx": routeImport,
  "modules/fixture-a/route-import.ts": routeImport,
  "modules/fixture-a/ui-import.ts": barrelTiers,
  "modules/fixture-a/shared-component-import.ts": barrelTiers,
  "modules/fixture-a/shared-query-import.ts": barrelTiers,
  "modules/fixture-a/lib-import.ts": barrelTiers,
  "modules/fixture-a/views/SharedQueryImport.tsx": viewTiers,
  "modules/fixture-a/views/LibImport.tsx": viewTiers,
  "modules/fixture-a/containers/LibImport.tsx": containerTiers,
  "modules/fixture-a/components/SharedQueryImport.tsx": componentTiers,
  "modules/fixture-a/components/LibImport.tsx": componentTiers,
  "modules/fixture-a/hooks/use-ui-import.ts": hookTiers,
  "modules/fixture-a/hooks/use-shared-component-import.ts": hookTiers,
  "modules/fixture-a/hooks/use-shared-query-import.ts": hookTiers,
  "modules/fixture-a/hooks/use-lib-import.ts": hookTiers,
  "modules/fixture-a/queries/ui-import.ts": queryTiers,
  "modules/fixture-a/queries/shared-component-import.ts": queryTiers,
  "modules/fixture-a/queries/lib-import.ts": queryTiers,
  "modules/fixture-a/domain/ui-import.ts": domainTiers,
  "modules/fixture-a/domain/shared-component-import.ts": domainTiers,
  "modules/fixture-a/domain/shared-query-import.ts": domainTiers,
  "modules/fixture-a/domain/lib-import.ts": domainTiers,
  "modules/fixture-a/domain/container-import.ts": `A module domain file imports only these layers of its own module: domain ${doc}`,
  "modules/fixture-a/views/QueryImport.tsx": `A module view file imports only these layers of its own module: view, container, component ${doc}`,
  "modules/fixture-a/components/ContainerImport.tsx": `A module component file imports only these layers of its own module: component, hook, domain ${doc}`,
  "modules/fixture-a/hooks/use-component-import.ts": `A module hook file imports only these layers of its own module: hook, domain ${doc}`,
  "modules/fixture-a/hooks/use-legacy-hook.ts": legacy,
  "modules/fixture-a/containers/ShellImport.tsx": legacy,
  "modules/fixture-a/domain/viewer-import.ts": legacy,
  "modules/fixture-a/components/SiblingImport.tsx": sibling,
  "routes/LayerRoute.tsx":
    "A route imports a module only through its index.ts barrel (docs/standards/frontend-architecture.md, Import matrix).",
  "modules/fixture-a/components/FeatureImport.tsx": legacy,
  "components/ui/fixture-red.tsx":
    "A components/ui file imports only components/ui and src/web/lib/ (docs/standards/frontend-architecture.md, Import matrix).",
  "components/ModuleImport.tsx": sharedComponentRow,
  "modules/fixture-a/sibling-import.ts": sibling,
  "modules/fixture-a/primitives-import.ts": legacy,
  "modules/fixture-a/legacy-hook-import.ts": legacy,
  "modules/fixture-a/feature-import.ts": legacy,
  "modules/fixture-a/shell-import.ts": legacy,
  "components/shared-query-import.ts": sharedComponentRow,
  "components/route-import.ts": sharedComponentRow,
  "components/lib-import.ts": sharedComponentRow,
  "components/primitives-import.ts": sharedComponentRow,
  "components/legacy-hook-import.ts": sharedComponentRow,
  "components/feature-import.ts": sharedComponentRow,
  "components/shell-import.ts": sharedComponentRow,
  "queries/ui-import.ts": sharedQueryRow,
  "queries/shared-component-import.ts": sharedQueryRow,
  "queries/utils-import.ts": sharedQueryRow,
  "queries/lib-import.ts": sharedQueryRow,
  "queries/barrel-import.ts": sharedQueryRow,
  "queries/layer-import.ts": sharedQueryRow,
  "queries/route-import.ts": sharedQueryRow,
  "queries/primitives-import.ts": sharedQueryRow,
  "queries/legacy-hook-import.ts": sharedQueryRow,
  "queries/feature-import.ts": sharedQueryRow,
  "queries/shell-import.ts": sharedQueryRow,
};

for (const [rel, message] of Object.entries(red)) {
  void test(`${rel} fails ${RULE}`, () => {
    assert.deepEqual(boundaryMessages(rel), [message]);
  });
}

const BAN_RULES = new Set(["no-restricted-syntax", "no-restricted-imports"]);
const syntaxRule = "no-restricted-syntax: ";
const styleSyntax = `${syntaxRule}Do not use the JSX style prop. Use Tailwind token classes (docs/standards/frontend-architecture.md, The only-shadcn rule).`;
const hexSyntax = `${syntaxRule}Do not write a hex colour. Add a token to src/web/styles/tokens.css and use its Tailwind token class (docs/standards/frontend-architecture.md, The only-shadcn rule).`;
const dashSyntax = `${syntaxRule}No em dashes, spaced en dashes, or double hyphens in copy. Use a comma, period, colon, or rephrase.`;
const fetchSyntax = `${syntaxRule}Only query files call fetch or create an EventSource (docs/standards/frontend-architecture.md, Import matrix).`;
const radixMessage =
  "Import Radix only in components/ui. Compose the shadcn primitive (docs/standards/frontend-architecture.md, The only-shadcn rule).";
const apiMessage =
  "src/web/lib/api.ts is part of the legacy tree, and the new tree does not import the legacy tree. A query file calls src/web/lib/http.ts (docs/standards/frontend-architecture.md, Status and scope, Import matrix global ban 3).";
const httpMessage =
  "Only query files import src/web/lib/http.ts (docs/standards/frontend-architecture.md, Layer definitions).";
const queryMessage =
  "Import TanStack Query only in query files, containers and src/web/queries/, and in a route only as a type. Views, components, hooks and domain files never import it (docs/standards/frontend-architecture.md, Layer definitions).";
const routerMessage =
  "Import TanStack Router only in routes, views and containers. Components and domain files never import it (docs/standards/frontend-architecture.md, Layer definitions).";

/**
 * Formats the message no-restricted-imports reports for a pattern ban.
 */
function imported(source: string, message: string): string {
  return `no-restricted-imports: '${source}' import is restricted from being used by a pattern. ${message}`;
}

/**
 * Lists the style, hex, copy, fetch and import ban messages reported for one fixture.
 */
function banMessages(rel: string): string[] {
  const result = results.get(rel);
  assert.ok(result, `no lint result for ${rel}`);
  return result.messages
    .filter((message) => message.ruleId && BAN_RULES.has(message.ruleId))
    .map((message) => `${message.ruleId}: ${message.message}`);
}

for (const rel of [
  "components/ui/style-ok.tsx",
  "modules/fixture-a/components/dnd/DndStyle.tsx",
  "routes/TypeImportRoute.tsx",
  "modules/fixture-a/containers/QueryContainer.tsx",
  "modules/fixture-a/views/RouterView.tsx",
  "modules/fixture-a/queries/http-query.ts",
  "queries/shared-http.ts",
  "modules/fixture-a/queries/http-suffix-query.ts",
  "components/ui/radix-ok.tsx",
  "modules/fixture-a/components/ColorMix.tsx",
  "features/fixture-legacy/LegacyStyle.tsx",
]) {
  void test(`${rel} passes the new-tree bans`, () => {
    assert.deepEqual(banMessages(rel), []);
  });
}

const banned: Record<string, string[]> = {
  "modules/fixture-a/queries/api-query.ts": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/queries/relative-api-query.ts": [
    imported("../../../lib/api", apiMessage),
  ],
  "queries/api-shared.ts": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/views/TanstackQueryView.tsx": [
    imported("@tanstack/react-query", queryMessage),
  ],
  "modules/fixture-a/hooks/use-tanstack-query.ts": [
    imported("@tanstack/react-query", queryMessage),
  ],
  "modules/fixture-a/hooks/use-tanstack-router.ts": [
    imported("@tanstack/react-router", routerMessage),
  ],
  "modules/fixture-a/queries/router-query.ts": [
    imported("@tanstack/react-router", routerMessage),
  ],
  "modules/fixture-a/components/InlineStyle.tsx": [styleSyntax],
  "routes/HexRoute.tsx": [hexSyntax],
  "components/ui/hex-ui.tsx": [hexSyntax],
  "components/HexShared.tsx": [hexSyntax],
  "modules/fixture-a/domain/hex-template.ts": [hexSyntax],
  "modules/fixture-a/components/RadixImport.tsx": [
    imported("@radix-ui/react-dialog", radixMessage),
  ],
  "modules/fixture-a/components/QueryComponent.tsx": [
    imported("@tanstack/react-query", queryMessage),
  ],
  "modules/fixture-a/components/RouterComponent.tsx": [
    imported("@tanstack/react-router", routerMessage),
  ],
  "routes/QueryValueRoute.tsx": [
    imported("@tanstack/react-query", queryMessage),
  ],
  "modules/fixture-a/components/DashCopy.tsx": [dashSyntax],
  "modules/fixture-a/components/DoubleHyphen.tsx": [dashSyntax],
  "features/fixture-legacy/LegacyDash.tsx": [dashSyntax],
  "modules/fixture-a/components/FetchComponent.tsx": [fetchSyntax],
  "modules/fixture-a/hooks/use-event-source.ts": [fetchSyntax],
  "modules/fixture-a/containers/HttpContainer.tsx": [
    imported("@/lib/http", httpMessage),
  ],
  "modules/fixture-a/api-barrel.ts": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/views/ApiView.tsx": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/containers/ApiContainer.tsx": [
    imported("@/lib/api", apiMessage),
  ],
  "modules/fixture-a/components/ApiComponent.tsx": [
    imported("@/lib/api", apiMessage),
  ],
  "modules/fixture-a/hooks/use-api.ts": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/domain/api-domain.ts": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/domain/relative-api.ts": [
    imported("../../../lib/api", apiMessage),
  ],
  "routes/ApiRoute.tsx": [imported("@/lib/api", apiMessage)],
  "components/ui/api-ui.tsx": [imported("@/lib/api", apiMessage)],
  "components/ApiShared.tsx": [imported("@/lib/api", apiMessage)],
  "modules/fixture-a/http-barrel.ts": [imported("@/lib/http", httpMessage)],
  "modules/fixture-a/views/HttpView.tsx": [imported("@/lib/http", httpMessage)],
  "modules/fixture-a/components/HttpComponent.tsx": [
    imported("@/lib/http", httpMessage),
  ],
  "modules/fixture-a/hooks/use-http.ts": [imported("@/lib/http", httpMessage)],
  "modules/fixture-a/domain/http-domain.ts": [
    imported("@/lib/http", httpMessage),
  ],
  "components/HttpShared.tsx": [imported("@/lib/http", httpMessage)],
  "components/ui/http-ui.tsx": [imported("@/lib/http", httpMessage)],
  "routes/HttpRoute.tsx": [imported("@/lib/http", httpMessage)],
  "modules/fixture-a/containers/ApiSuffixContainer.tsx": [
    imported("@/lib/api.js", apiMessage),
  ],
  "modules/fixture-a/components/HttpSuffixComponent.tsx": [
    imported("../../../lib/http.js", httpMessage),
  ],
};

for (const [rel, messages] of Object.entries(banned)) {
  void test(`${rel} fails the new-tree bans`, () => {
    assert.deepEqual(banMessages(rel), messages);
  });
}

void test("the fixture run leaves no files behind", () => {
  assert.ok(createdFiles.length > 0);
  for (const target of [...createdFiles, ...createdDirs])
    assert.equal(fs.existsSync(target), false, target);
});
