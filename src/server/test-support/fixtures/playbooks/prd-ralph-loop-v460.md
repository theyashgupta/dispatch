---
name: PRD + Ralph Loop
when: One ticket or one feature of one module, up to a few hundred lines, with phases, QA and a gap analysis.
---
## Extra direction
{extra}

## Workflow
Use the grill-me skill first to stress-test the scope of this ticket until requirements stop changing. Once the scope is settled, use the write-prd skill to produce a phased PRD.md for it. Then use the ralph-loop skill to execute the PRD phase by phase (default --qa-subagent mode unless the PRD is trivial). Hand off between steps by naming the PRD's path when moving from write-prd to ralph-loop.