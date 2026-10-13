export function CentreView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <section aria-label="Canvas" className="min-h-0 min-w-0 flex-1">
        <p className="sr-only">Loading command centre</p>
      </section>
      <aside
        aria-label="Conversation"
        className="w-full shrink-0 border-t border-border md:w-90 md:border-t-0 md:border-l xl:w-105"
      />
    </div>
  );
}
