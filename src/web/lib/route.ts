export const PAGES = [
  "board",
  "inbox",
  "sessions",
  "workspace",
  "settings",
  "activity",
  "accounts",
  "playbooks",
  "vault",
  "archive",
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
