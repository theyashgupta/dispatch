/**
 * Validate the seed builder arguments and return the kind, the port and the fixed time.
 *
 * @remarks
 * The port floor of 48400 keeps a run above every live service port (4700, 4710, 47990, 5291), so a rejection stops the run before any file is written.
 */
export function parseSeedArgs(argv, env) {
  const [kind, portArg] = argv;
  const port = Number(portArg);
  const now = Date.parse(env.DISPATCH_VISUAL_NOW ?? "");
  if (kind !== "seeded" && kind !== "fresh")
    throw new Error("usage: node tests/visual/seed.mjs <seeded|fresh> <port>");
  if (!Number.isInteger(port) || port <= 48400)
    throw new Error(`port ${portArg} not allowed, use a free port above 48400`);
  if (!Number.isFinite(now))
    throw new Error("DISPATCH_VISUAL_NOW must be an ISO time");
  return { kind, port, now };
}
