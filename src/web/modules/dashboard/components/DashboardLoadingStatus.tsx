interface DashboardLoadingStatusProps {
  loading: boolean;
}

export function DashboardLoadingStatus({
  loading,
}: DashboardLoadingStatusProps) {
  return (
    <span role="status" className="sr-only">
      {loading ? "Loading dashboard" : ""}
    </span>
  );
}
