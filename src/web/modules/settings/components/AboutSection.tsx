import { ExternalLink } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Caption } from "@/modules/settings/components/Caption";
import {
  LICENSE_NAME,
  REPOSITORY_URL,
} from "@/modules/settings/domain/about-meta";

interface AboutSectionProps {
  version: string | undefined;
}

export function AboutSection({ version }: AboutSectionProps) {
  return (
    <>
      <Field className="gap-1">
        <Caption>Version</Caption>
        <span className="text-base text-foreground">
          {version !== undefined ? `Dispatch ${version}` : "Dispatch"}
        </span>
      </Field>
      <Field className="gap-1">
        <Caption>Repository</Caption>
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 self-start rounded-sm text-base text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ExternalLink aria-hidden="true" className="size-3" />
          {REPOSITORY_URL.replace(/^https:\/\//, "")}
        </a>
      </Field>
      <Field className="gap-1">
        <Caption>License</Caption>
        <span className="text-base text-foreground">{LICENSE_NAME}</span>
      </Field>
    </>
  );
}
