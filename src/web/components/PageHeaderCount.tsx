export function PageHeaderCount({ count }: { count: number }) {
  return (
    <span className="text-sm font-medium text-muted-foreground">{count}</span>
  );
}
