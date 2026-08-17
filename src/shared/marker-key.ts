/**
 * The `Marker.kind` spelling for a pause marker, and the `markerKey()` prefix built from it.
 * Both live in `shared` because the two modules that must agree on this format —
 * `adapters/markers/parse.ts`, which PRODUCES the key, and `store/board.store.ts`, whose
 * cross-session flip-back gate MATCHES on it — cannot import each other under the boundaries DAG
 * (`adapters` may import `store`, never the reverse), so a bare string literal in each would be
 * two independent facts with nothing linking them.
 * @remarks The gate that reads this FAILS OPEN: a prefix that stops matching does not throw, it
 * silently stops suppressing, so a drift between the two spellings would be invisible in
 * behaviour. That asymmetry is the whole reason this is a shared constant rather than a literal
 * repeated twice.
 * @remarks `parse.ts`'s own `MARKER_RE` still spells `NEEDS_INPUT` inside its alternation — a
 * regex source cannot be assembled from this constant without losing the literal-pattern
 * readability the marker protocol depends on. The link this constant DOES close is the one that
 * fails silently; `MARKER_RE` drifting instead fails loudly, because nothing would parse at all.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export const NEEDS_INPUT_MARKER_KIND = "NEEDS_INPUT";

/**
 * Prefix a `markerKey()` result carries when its marker is a pause: the kind literal plus the
 * single space `markerKey` joins on.
 */
export const NEEDS_INPUT_MARKER_PREFIX = `${NEEDS_INPUT_MARKER_KIND} `;
