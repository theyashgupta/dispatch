import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import type { ShipBlock } from "@/modules/dashboard/domain/ship-rows";
import { DashboardSection } from "./DashboardSection";
import { ShipGlyphBadge } from "./ShipGlyphBadge";

interface ShipSectionProps {
  state: SectionState;
  blocks: ShipBlock[];
  onRetry: () => void;
}

function FlowBadge({ block }: { block: ShipBlock }) {
  return (
    <ShipGlyphBadge
      label={block.failed ?? block.flow.label}
      glyph={block.flow.glyph}
      tone="neutral"
    />
  );
}

export function ShipSection({ state, blocks, onRetry }: ShipSectionProps) {
  return (
    <DashboardSection
      title="PRs and merge order"
      count={blocks.length}
      state={state}
      onRetry={onRetry}
    >
      {blocks.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No PRs yet.</p>
      ) : (
        blocks.map((block) => (
          <div
            key={block.cardId}
            className="rounded-md border border-border bg-card"
          >
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="font-mono text-xs font-semibold text-foreground">
                {block.groupId}
              </span>
              <FlowBadge block={block} />
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">Order</TableHead>
                    <TableHead scope="col">Branch</TableHead>
                    <TableHead scope="col">PR</TableHead>
                    <TableHead scope="col">Ship state</TableHead>
                    <TableHead scope="col">Checks</TableHead>
                    <TableHead scope="col">Author</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {block.branches.map((branch) => (
                    <TableRow key={branch.order}>
                      <TableCell className="tabular-nums">
                        {branch.order}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {branch.name}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {branch.pr}
                      </TableCell>
                      <TableCell>
                        <ShipGlyphBadge {...branch.state} />
                      </TableCell>
                      <TableCell>
                        <ShipGlyphBadge {...branch.checks} />
                      </TableCell>
                      <TableCell>
                        <ShipGlyphBadge {...branch.identity} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ItemGroup className="border-t border-border md:hidden">
              {block.branches.map((branch) => (
                <Item
                  key={branch.order}
                  role="listitem"
                  size="sm"
                  className="flex-nowrap border-0 border-b last:border-b-0"
                >
                  <ItemContent className="min-w-0 gap-2">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs tabular-nums">
                      <span className="text-muted-foreground">
                        {branch.order}
                      </span>
                      <span className="font-mono wrap-anywhere text-foreground">
                        {branch.name}
                      </span>
                      <span className="text-muted-foreground">{branch.pr}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ShipGlyphBadge {...branch.state} />
                      <ShipGlyphBadge {...branch.checks} />
                      <ShipGlyphBadge {...branch.identity} />
                    </div>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </div>
        ))
      )}
    </DashboardSection>
  );
}
