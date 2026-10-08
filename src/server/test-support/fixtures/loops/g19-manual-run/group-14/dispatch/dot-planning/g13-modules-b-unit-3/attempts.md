phase 2 RED attempt 1 2026-10-06T13:32:23Z prettier on 3 files; JSDoc on ORCA_SECTIONS constant; comments placeholder rule and test missing (brief gap)
phase 3 RED attempt 1 2026-10-06T14:04:01Z 390 px horizontal overflow of the Sessions list (GroupCollapsible grid child lacks min-w-0); Lost rows at 390 not captured
phase 3 RED attempt 2 2026-10-06T14:13:54Z 390 px title truncation (row lost about 6 px: badge 2 px, checkbox 16 vs 13 px); GroupCollapsible regression check never mounted the component (R-26/R-28 extra rounds)
phase 5 RED attempt 1 2026-10-06T15:59:47Z Run Claude label clipped in the 110 px docked panel at 390 px (shadcn Button nowrap and shrink-0; legacy wraps); hover tint and unwind focus ruling gaps
phase 6 RED attempt 1 2026-10-06T16:47:50Z docs/ARCHITECTURE.md:1697 cites the deleted web/features/orca/ folder (doc-drift checks only paths with an extension)
phase 7 BUG (readiness C) 2026-10-06T18:22:35Z unwind picker first-item focus raced Radix open autofocus (rAF vs onOpenAutoFocus); ArrowDown then Enter sent todo or inbox by timing
phase 8 RED attempt 1 2026-10-06T22:38:46Z audit: G8 Reconnect and retry POST never recorded (evidence gap); ui grade: Open in Linear Button asChild anchor shows UA link blue and underline (globals.css reset covered button[data-slot] only), T38-390 terminal text differs
