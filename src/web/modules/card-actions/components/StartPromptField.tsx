import type { RefObject } from "react";
import { Textarea } from "@/components/ui/textarea";

interface StartPromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

export function StartPromptField({
  value,
  onChange,
  placeholder,
  textareaRef,
}: StartPromptFieldProps) {
  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Prompt for Claude"
      placeholder={placeholder}
      variant="surface"
      className="field-sizing-fixed min-h-24 flex-none resize-y p-2 text-base md:text-base"
    />
  );
}
