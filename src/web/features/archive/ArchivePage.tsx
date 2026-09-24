import { PageBody } from "../../primitives/PageBody.js";
import { ArchiveSection } from "./ArchiveSection.js";

interface ArchivePageProps {
  onCountChange: (count: number | undefined) => void;
}

export function ArchivePage({ onCountChange }: ArchivePageProps) {
  return (
    <PageBody>
      <ArchiveSection onCountChange={onCountChange} />
    </PageBody>
  );
}
