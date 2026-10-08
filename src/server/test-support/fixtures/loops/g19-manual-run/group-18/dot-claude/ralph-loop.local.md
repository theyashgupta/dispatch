---
active: true
iteration: 39
session_id: handoff-pending
max_iterations: 139
completion_promise: "ROADMAP COMPLETE g18-orch-runtime"
started_at: "2026-10-06T13:54:45Z"
---

Execute the roadmap at ROADMAP.md per the roadmap-loop skill, slug g18-orch-runtime. Read .roadmap/g18-orch-runtime/progress.md, take the lowest incomplete unit, and continue from its recorded position. The trailing specs branch for this roadmap is test/g18-orch-runtime-specs (R-01). Unit 4 execution waits for LOCAL-77 and LOCAL-87 on origin/main (R-19); until then follow the gate note in progress.md. When and only when every unit's status in progress.md is committed, the trailing test/g18-orch-runtime-specs branch exists with the specs committed, and the roadmap's every unit row says built, awaiting /ship, output the phrase ROADMAP COMPLETE g18-orch-runtime wrapped in promise tags. Keep the DISPATCH_STATUS rule: whenever you stop to wait for a human, end that message with its own line DISPATCH_STATUS: NEEDS_INPUT - <reason>; when the roadmap is finished and handed back, end with DISPATCH_STATUS: DONE - <summary>.
