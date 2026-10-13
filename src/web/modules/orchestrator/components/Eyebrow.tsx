interface EyebrowProps {
  as?: "span" | "p" | "h3";
  id?: string;
  children: string;
}

export function Eyebrow({ as: Tag = "span", id, children }: EyebrowProps) {
  return (
    <Tag
      id={id}
      className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {children}
    </Tag>
  );
}
