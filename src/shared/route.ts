export const PAGES = [
  "board",
  "inbox",
  "sessions",
  "tickets",
  "workspace",
  "settings",
  "activity",
  "accounts",
  "playbooks",
  "vault",
  "archive",
  "pull-requests",
  "errors",
  "today",
  "slack",
  "meetings",
  "calendar",
  "workspaces",
  "ask",
  "flow",
] as const;

export type Page = (typeof PAGES)[number];

export interface Route {
  page: Page;
  id?: string;
}

const BOARD: Route = { page: "board" };

function isPage(value: string): value is Page {
  return (PAGES as readonly string[]).includes(value);
}

/**
 * Parses a location hash into a route, mapping anything unknown or empty to the board.
 * @remarks The hash is untrusted text from the URL bar, a push link or the tunnel, so an unknown
 * page never reaches the route switch: the board is the one page that always exists.
 */
export function parseRoute(hash: string): Route {
  const trimmed = hash.replace(/^#\/?/, "");
  if (trimmed === "") return BOARD;
  const [page, ...rest] = trimmed.split("/");
  if (page === undefined || !isPage(page)) return BOARD;
  const id = rest.join("/");
  if (id === "") return { page };
  try {
    return { page, id: decodeURIComponent(id) };
  } catch {
    return { page, id };
  }
}

/**
 * Serializes the route worth remembering for a later load: the parsed hash, minus an Ask id.
 *
 * @remarks An Ask id is a one-shot prefilled question, so a later load must never re-fill it.
 */
export function rememberedHash(hash: string): string {
  const route = parseRoute(hash);
  return routeHash(route.page === "ask" ? { page: route.page } : route);
}

/** Serializes a route to the hash `parseRoute` reads back, always with the leading `#/`. */
export function routeHash(route: Route): string {
  return route.id == null || route.id === ""
    ? `#/${route.page}`
    : `#/${route.page}/${encodeURIComponent(route.id)}`;
}

/**
 * Decides the hash the app should show on first load: the current hash wins, then the remembered
 * route, then the legacy workspace view, then the board.
 * @remarks Every stored value is re-parsed and re-serialized, so a stale or corrupt entry can
 * only ever redirect to a page that exists.
 */
export function initialHash(
  currentHash: string,
  storedRoute: string | null,
  legacyView: string | null,
): string {
  if (currentHash !== "" && currentHash !== "#" && currentHash !== "#/") {
    return routeHash(parseRoute(currentHash));
  }
  if (storedRoute != null && storedRoute !== "") {
    return routeHash(parseRoute(storedRoute));
  }
  if (legacyView === "workspace" || legacyView === "orca") {
    return "#/workspace";
  }
  return "#/board";
}

/** Map an unmatched pathname to the canonical page path, or `/board` when it is already canonical. */
export function notFoundTarget(pathname: string): string {
  const target = routeHash(parseRoute(`#${pathname}`)).slice(1);
  return target === pathname ? "/board" : target;
}

/**
 * Resolve the committed route from the deepest router match, falling back to the pathname.
 *
 * @remarks
 * The root, a missing match and a notFound match carry no page, so the pathname is parsed instead. A page leaf keeps its param as the router decoded it.
 */
export function routeFromMatch(
  leaf:
    { routeId: string; params: { id?: string }; status?: string } | undefined,
  pathname: string,
): Route {
  if (
    leaf === undefined ||
    leaf.routeId === "__root__" ||
    leaf.status === "notFound"
  ) {
    return parseRoute(`#${pathname}`);
  }
  const page = parseRoute(`#/${leaf.routeId.split("/")[1] ?? ""}`).page;
  const id = leaf.params.id;
  return id === undefined ? { page } : { page, id };
}
