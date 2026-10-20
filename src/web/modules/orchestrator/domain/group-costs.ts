import type { CentreBranch, CentreGraph } from "./centre-graph.js";

/** Replace the cost and budget of each branch whose card is a group in the summary. */
export function withGroupCosts(
  graph: CentreGraph,
  groups: readonly { cardId: string; cost: number; budget: number | null }[],
): CentreGraph {
  if (groups.length === 0) return graph;
  const byCard = new Map(groups.map((g) => [g.cardId, g]));
  const apply = (branch: CentreBranch): CentreBranch => {
    const group =
      branch.cardId === null ? undefined : byCard.get(branch.cardId);
    return group === undefined
      ? branch
      : { ...branch, cost: group.cost, budget: group.budget };
  };
  return {
    ...graph,
    branches: graph.branches.map(apply),
    bands: graph.bands.map((band) => ({
      ...band,
      branches: band.branches.map(apply),
    })),
  };
}
