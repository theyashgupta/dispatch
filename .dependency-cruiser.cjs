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
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "A file that no other file imports and that imports nothing is dead code.",
      from: {
        orphan: true,
        path: "^src/(web|server)/",
        pathNot: [
          "\\.d\\.ts$",
          "^src/web/(main|viewer-main|gallery-main)\\.tsx$",
          "^src/web/terminal-main\\.ts$",
          "^src/web/routeTree\\.gen\\.ts$",
          "^src/server/bootstrap/(index|cli)\\.ts$",
          "^src/web/public/",
        ],
      },
      to: {},
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
    {
      name: "mcp-server-isolated",
      severity: "error",
      comment:
        "The MCP tool server imports only src/shared, zod, the SDK and node built-ins, so it never reaches the app it calls over HTTP.",
      from: { path: "^src/server/bootstrap/mcp-(server|tools)\\.ts$" },
      to: { path: "^src/server/(routes|services|store|adapters|sources)/" },
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
