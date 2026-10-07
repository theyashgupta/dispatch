import { Button } from "@/components/ui/button";

interface PastedImageStripProps {
  images: { id: string; url: string }[];
  disabled: boolean;
  onRemove: (id: string) => void;
}

export function PastedImageStrip({
  images,
  disabled,
  onRemove,
}: PastedImageStripProps) {
  return (
    <div data-testid="pasted-images" className="flex flex-wrap gap-2 py-1">
      {images.map((img, i) => (
        <div key={img.id} className="relative">
          <img
            src={img.url}
            alt={`Pasted image ${i + 1}`}
            className="block size-16 rounded-md border border-border object-cover"
          />
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Remove pasted image ${i + 1}`}
            disabled={disabled}
            onClick={() => onRemove(img.id)}
            className="absolute -top-1.5 -right-1.5 size-5 rounded-xs border-border bg-card text-foreground dark:bg-card"
          >
            ×
          </Button>
        </div>
      ))}
    </div>
  );
}
