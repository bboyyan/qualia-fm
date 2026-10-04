import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './ui.module.css';

type Variant = 'primary' | 'outline' | 'text' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  block?: boolean;
  children: ReactNode;
}

/** 48–56px tall; loading keeps width stable (spinner overlays the label). */
export function Button({
  variant = 'primary',
  icon,
  trailingIcon,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], block ? styles.block : '', loading ? styles.loading : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      <span className={styles.buttonLabel}>
        {icon && <Icon name={icon} size={20} />}
        {children}
        {trailingIcon && <Icon name={trailingIcon} size={20} />}
      </span>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  tone?: 'plain' | 'primary' | 'inverse';
  size?: 'md' | 'lg';
}

/** Icon-only control: always has an accessible name and a ≥48px hit area. */
export function IconButton({ icon, label, tone = 'plain', size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  const classes = [styles.iconButton, styles[`icon-${tone}`], size === 'lg' ? styles.iconLarge : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} type={type} className={classes} aria-label={label}>
      <Icon name={icon} size={size === 'lg' ? 26 : 22} />
    </button>
  );
}
