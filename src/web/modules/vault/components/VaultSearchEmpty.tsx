interface VaultSearchEmptyProps {
  query: string;
}

export function VaultSearchEmpty({ query }: VaultSearchEmptyProps) {
  return (
    <span
      data-testid="vault-search-empty"
      className="text-sm text-muted-foreground"
    >
      No keys match "{query}".
    </span>
  );
}
