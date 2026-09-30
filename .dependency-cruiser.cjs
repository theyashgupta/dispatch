const legacyCycleFiles = [
  "^src/web/features/vault/(VaultPage|VaultKeyRow|VaultValueEditor|VaultImportConfirm|VaultAddForm)\\.tsx$",
  "^src/web/features/board/(index\\.ts|Board\\.tsx)$",
  "^src/web/features/modals/(index\\.ts|GroupStartModal\\.tsx)$",
];

const serviceDirection = (name, from, to) => ({
  name,
  severity: "warn",
  comment: `${from} breaks the service import direction (docs/standards/backend-design.md, Import direction inside services). Ticket 18 moves it.`,
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
