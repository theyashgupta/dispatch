import { Badge } from "@/components/ui/badge";

interface BoardNameMarksProps {
  isDefault: boolean;
  keyClash: boolean;
}

export function BoardNameMarks({ isDefault, keyClash }: BoardNameMarksProps) {
  return (
    <>
      {isDefault && <Badge tone="neutral">Default</Badge>}
      {keyClash && <Badge tone="neutral">Key clash</Badge>}
    </>
  );
}
