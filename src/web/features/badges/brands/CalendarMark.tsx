import { MarkSvg, type MarkProps } from "./MarkSvg.js";

export function CalendarMark({ size = 16 }: MarkProps) {
  return (
    <MarkSvg size={size}>
      <path
        fillRule="evenodd"
        d="M5 4h14a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9ZM14 14h4v4h-4Z"
      />
      <path d="M6 2h2v4H6ZM16 2h2v4h-2Z" />
    </MarkSvg>
  );
}
