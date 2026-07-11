/**
 * Start-flow request shape shared by Board, App, and StartModal; lives in
 * lib so consumers never type-import across feature files.
 */
export interface StartRequest {
  cardId: string;
  targetColumn: "in_planning" | "in_progress";
  variant: "full" | "handoff";
}
