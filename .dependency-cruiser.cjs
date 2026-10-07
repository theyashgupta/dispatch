const legacyCycleFiles = ["^src/web/features/board/(index\\.ts|Board\\.tsx)$"];

const serviceDirection = (name, from, to) => ({
  name,
  severity: "error",
  comment: `${from} breaks the service import direction (docs/standards/backend-design.md, Import direction inside services).`,
  from: {
    path: `^src/server/services/${from}/`,
    pathNot: "\\.test\\.ts$",
  },
  to: { path: to },
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Import cycles are not allowed.",
      from: { pathNot: legacyCycleFiles },
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "A file that no other file imports and that imports nothing is dead code.",
      from: {
        orphan: true,
        path: "^src/(web/modules|server)/",
        pathNot: "\\.d\\.ts$",
      },
      to: {},
    },
    {
      name: "modules-not-from-features",
      severity: "error",
      comment:
        "A module does not import the legacy tree (docs/standards/frontend-architecture.md, Import matrix).",
      from: { path: "^src/web/modules/" },
      to: { path: "^src/web/features/" },
    },
    {
      name: "board-store-through-repository",
      severity: "error",
      comment:
        "Routes and services call the board store through boardRepository (docs/standards/backend-design.md, Agent rules block rule 3).",
      from: {
        path: "^src/server/(routes|services)/",
        pathNot: "\\.test\\.ts$",
      },
      to: { path: "^src/server/store/board\\.store\\.ts$" },
    },
    {
      name: "test-support-in-tests-only",
      severity: "error",
      comment:
        "Only test files import src/server/test-support (docs/standards/backend-design.md, Tests).",
      from: {
        path: "^src/",
        pathNot: ["\\.test\\.ts$", "^src/server/test-support/"],
      },
      to: { path: "^src/server/test-support/" },
    },
    serviceDirection(
      "services-domain-direction",
      "domain",
      "^src/server/(adapters|store|sources|routes|bootstrap|services/(infra|orchestration))/",
    ),
    serviceDirection(
      "services-infra-direction",
      "infra",
      "^src/server/(sources|routes|bootstrap|services/(domain|orchestration))/",
    ),
    serviceDirection(
      "services-orchestration-direction",
      "orchestration",
      "^src/server/(routes|bootstrap)/",
    ),
  ],
  options: {
    exclude: { path: "(^|/)node_modules/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
