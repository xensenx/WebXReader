interface IncognitoIconProps {
  size?: number;
}

export function IncognitoIcon({ size = 18 }: IncognitoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 9.6 5.4 4.8a2.4 2.4 0 0 1 2.1-1.3h9a2.4 2.4 0 0 1 2.1 1.3L21 9.6" />
      <path d="M2.2 10c2.9-.9 6.2-1.4 9.8-1.4s6.9.5 9.8 1.4" />
      <path d="M4.4 13.2H2.8m18.4 0h-1.6" />
      <circle cx="7.2" cy="14.2" r="2.6" />
      <circle cx="16.8" cy="14.2" r="2.6" />
      <path d="M9.8 13.5c.7-.6 1.3-.6 2.2 0 .9-.6 1.5-.6 2.2 0" />
    </svg>
  );
}
