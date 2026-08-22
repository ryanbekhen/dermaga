import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  /** Swaps the icon for a spinner and blocks further clicks. */
  busy?: boolean;
  /** Shown in place of the label while busy, e.g. "Starting…". */
  busyLabel?: string;
  /**
   * Draw the icon alone, with the label kept as its tooltip.
   *
   * For the rows of verbs that appear beside a selection, or along a detail
   * page's header, where four or five labelled buttons in a line make every
   * one of them look as likely as the next.
   */
  iconOnly?: boolean;
  children?: ReactNode;
}

/**
 * A button that shows its work. Disabling alone leaves people wondering whether
 * the click registered, so anything that waits on the CLI spins instead.
 */
export function Button({
  variant = 'ghost',
  icon: Icon,
  busy = false,
  busyLabel,
  disabled,
  className = '',
  children,
  iconOnly = false,
  ...props
}: ButtonProps) {
  // Icon-only, and the words are not thrown away -- they become the tooltip
  // and the accessible name. A glyph with neither is a button only the person
  // who wrote it can use.
  if (iconOnly) {
    const label = typeof children === 'string' ? children : undefined;

    return (
      <button
        {...props}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        title={busy && busyLabel ? busyLabel : label}
        aria-label={label}
        className={`btn-plain ${className}`}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          Icon && <Icon size={16} aria-hidden />
        )}
      </button>
    );
  }

  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${VARIANTS[variant]} ${className}`}
    >
      {busy ? (
        <Loader2 size={13} className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon size={13} aria-hidden />
      )}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  busy?: boolean;
  /** Applied to the icon, e.g. a spin for restart. */
  iconClassName?: string;
}

export function IconButton({
  icon: Icon,
  busy = false,
  disabled,
  className = '',
  iconClassName = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      // Bare, like every other icon in a header. It wore a bordered square
      // until now, which left a row of five where two were boxed and three
      // were not -- and the boxes fell on whichever ones happened to be built
      // from this component rather than on anything a reader could name.
      className={`btn-plain ${className}`}
    >
      {busy ? (
        <Loader2 size={16} className="animate-spin" aria-hidden />
      ) : (
        <Icon size={16} className={iconClassName} aria-hidden />
      )}
    </button>
  );
}
