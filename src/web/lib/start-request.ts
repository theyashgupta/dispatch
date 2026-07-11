/**
 * Start-flow request shape shared by Board and App; lives in lib so
 * consumers never type-import across feature files.
 */
export interface StartRequest {
  cardId: string;
  targetColumn: "in_planning" | "in_progress";
  variant: "full" | "handoff";
}
