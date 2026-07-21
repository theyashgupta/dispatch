export function Spinner() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden={true}
      style={{
        animation: "spin 0.8s linear infinite",
        transformOrigin: "center",
        flex: "0 0 auto",
      }}
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="28.3 9.4"
      />
    </svg>
  );
}
