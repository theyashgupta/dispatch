import { Chip } from "./Chip.js";
import { dataInk } from "./data-ink.js";

interface StateChipProps {
  name: string;
  color: string;
  title?: string;
}

export function StateChip({ name, color, title }: StateChipProps) {
  return (
    <Chip
      title={title}
      icon={
        <span
          aria-hidden="true"
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: color,
            flex: "0 0 auto",
          }}
        />
      }
      style={{
        flex: "0 1 auto",
        minWidth: 0,
        maxWidth: "100%",
        color: dataInk(color),
        border: "none",
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {name}
    </Chip>
  );
}
