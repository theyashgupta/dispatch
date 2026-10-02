export interface ArchiveRowState {
  busy: boolean;
  error: string | null;
}

export const IDLE_ROW: ArchiveRowState = { busy: false, error: null };
