export interface PaletteState {
  query: string;
  highlight: number;
}

export type PaletteAction =
  | { type: "query"; query: string }
  | { type: "move"; delta: number; count: number };

export const INITIAL_PALETTE: PaletteState = { query: "", highlight: 0 };

const clamp = (index: number, count: number) =>
  Math.max(0, Math.min(index, count - 1));

/**
 * Palette input and highlight state over one index space: filtered commands, then card results.
 *
 * @remarks A new query resets the highlight to the first row and a move clamps it to the row
 * count it is given; the component clamps again at render when the rows change underneath.
 */
export function paletteReducer(
  state: PaletteState,
  action: PaletteAction,
): PaletteState {
  switch (action.type) {
    case "query":
      return { query: action.query, highlight: 0 };
    case "move":
      return {
        ...state,
        highlight: clamp(state.highlight + action.delta, action.count),
      };
  }
}

/** The row at a highlight index: a command first, then a card result after the commands. */
export function rowAt<C, R>(
  commands: readonly C[],
  results: readonly R[],
  index: number,
): { kind: "command"; command: C } | { kind: "card"; result: R } | null {
  if (index < commands.length) {
    const command = commands[index];
    return command === undefined ? null : { kind: "command", command };
  }
  const result = results[index - commands.length];
  return result === undefined ? null : { kind: "card", result };
}
