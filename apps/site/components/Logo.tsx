type LogoProps = {
  className?: string;
  title?: string;
};

/**
 * The kman mark: a ring with a horizon line and two rising rays (a stylized
 * sunrise / "K"). Drawn with currentColor so it adapts to light and dark.
 */
export function Logo({ className, title = "kman" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="16" cy="16" r="12.6" />
      <path d="M5.2 16h21.6" />
      <path d="M16 16 7 6.7" />
      <path d="M16 16l9-9.3" />
    </svg>
  );
}
