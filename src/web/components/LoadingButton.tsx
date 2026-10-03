import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean;
};

export function LoadingButton({
  loading = false,
  disabled,
  children,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      size="sm"
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner aria-hidden="true" className="size-3.5" />}
      {children}
    </Button>
  );
}
