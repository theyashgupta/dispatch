import { DEFAULT_BOARD_KEY } from "./board-key.js";

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
  "boards",
  "dashboard",
  "orchestrator",
  "board-settings",
] as const;

export const KEYED_PAGES = [
  "board",
  "dashboard",
  "orchestrator",
  "inbox",
  "sessions",
  "board-settings",
] as const;

export type Page = (typeof PAGES)[number];

export interface Route {
  page: Page;
  id?: string;
  board?: string;
}

const BOARD: Route = { page: "board" };

function isPage(value: string): value is Page {
  return (PAGES as readonly string[]).includes(value);
}

/** Whether the page lives under `/boards/<key>` once a board is known. */
export function isKeyedPage(page: Page): boolean {
  return (KEYED_PAGES as readonly string[]).includes(page);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseBoardsPath(segments: string[]): Route {
  const [key, child, ...tail] = segments;
  if (key === undefined || key === "") return { page: "boards" };
  const board = decode(key);
  if (child === "settings") return { page: "board-settings", board };
  if (
    child === "dashboard" ||
    child === "orchestrator" ||
    child === "inbox" ||
    child === "sessions"
  ) {
    const id = tail.join("/");
    return id === ""
      ? { page: child, board }
      : { page: child, board, id: decode(id) };
  }
  return { page: "board", board };
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
  if (page === "boards") return parseBoardsPath(rest);
  const id = rest.join("/");
  return id === "" ? { page } : { page, id: decode(id) };
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

/**
 * Serializes a route to the hash `parseRoute` reads back, always with the leading `#/`.
 *
 * @remarks A keyed page with a board becomes `#/boards/<key>/...`; without one it keeps its legacy
 * hash. Every id is encoded whole, since a pull request id can hold a slash.
 */
export function routeHash(route: Route): string {
  const id =
    route.id == null || route.id === ""
      ? ""
      : `/${encodeURIComponent(route.id)}`;
  if (route.board != null && route.board !== "" && isKeyedPage(route.page)) {
    const base = `#/boards/${encodeURIComponent(route.board)}`;
    if (route.page === "board") return base;
    if (route.page === "board-settings") return `${base}/settings`;
    return `${base}/${route.page}${id}`;
  }
  if (route.page === "board-settings") return "#/boards";
  return `#/${route.page}${id}`;
}

/**
 * The href, without the leading `#`, a shell navigation to a page on a board goes to.
 *
 * @remarks A keyed page carries the board in its path. Any other page carries it in a `board`
 * search parameter, which the default board omits.
 */
export function pageLocation(route: Route, board: string): string {
  if (isKeyedPage(route.page)) return routeHash({ ...route, board }).slice(1);
  const path = routeHash({ page: route.page, id: route.id }).slice(1);
  return board === DEFAULT_BOARD_KEY
    ? path
    : `${path}?board=${encodeURIComponent(board)}`;
}

/**
 * The href that switches the current page to another board, or null when the caller must replace the `board` search parameter in place.
 *
 * @remarks The id is dropped because it belongs to the old board.
 */
export function switchBoardLocation(
  route: Route,
  target: string,
): string | null {
  return isKeyedPage(route.page)
    ? pageLocation({ page: route.page }, target)
    : null;
}

/**
 * Decides the hash the app should show on first load: the current hash wins with its query, then
 * the remembered route, then the legacy workspace view, then the board.
 *
 * @remarks Every stored value is re-parsed and re-serialized, so a stale or corrupt entry can
 * only ever redirect to a page that exists.
 */
export function initialHash(
  currentHash: string,
  storedRoute: string | null,
  legacyView: string | null,
): string {
  if (currentHash !== "" && currentHash !== "#" && currentHash !== "#/") {
    const query = currentHash.indexOf("?");
    return query === -1
      ? routeHash(parseRoute(currentHash))
      : routeHash(parseRoute(currentHash.slice(0, query))) +
          currentHash.slice(query);
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
 * The root, a missing match and a notFound match carry no page, so the pathname is parsed instead. A page leaf keeps its param as the router decoded it, and a `/boards/$key` leaf also carries the board key.
 */
export function routeFromMatch(
  leaf:
    | {
        routeId: string;
        params: Record<string, string | undefined>;
        status?: string;
      }
    | undefined,
  pathname: string,
): Route {
  if (
    leaf === undefined ||
    leaf.routeId === "__root__" ||
    leaf.status === "notFound"
  ) {
    return parseRoute(`#${pathname}`);
  }
  if (leaf.routeId.startsWith("/boards/$key")) {
    const child = leaf.routeId.split("/")[3] ?? "";
    const page =
      child === "settings" ? "board-settings" : parseRoute(`#/${child}`).page;
    const id = leaf.params.id;
    const board = leaf.params.key;
    return id === undefined ? { page, board } : { page, board, id };
  }
  const page = parseRoute(`#/${leaf.routeId.split("/")[1] ?? ""}`).page;
  const id = leaf.params.id;
  return id === undefined ? { page } : { page, id };
}
