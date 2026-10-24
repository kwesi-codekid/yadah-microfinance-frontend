'use client';

import clsx from 'clsx';
import { forwardRef, useId } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type GlassProgressSize = 'sm' | 'md' | 'lg';

export type GlassProgressProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Text above the bar. It also names the bar for assistive technology. */
  label?: ReactNode;
  /** The value that means done. Defaults to 100. */
  max?: number;
  /** Shows the percentage beside the label. */
  showValue?: boolean;
  size?: GlassProgressSize;
  /** How far along. Leave it out, or pass null, when the length is unknown. */
  value?: number | null;
};

/**
 * A glass track with a fill that slides to its value. Without a value the fill sweeps
 * along, for work of unknown length.
 */
export const GlassProgress = forwardRef<HTMLDivElement, GlassProgressProps>(
  (
    {
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      className,
      label,
      max = 100,
      showValue = false,
      size = 'md',
      value,
      ...props
    },
    forwardedRef,
  ) => {
    const labelId = useId();
    const known = value !== null && value !== undefined && Number.isFinite(value);
    const clamped = known ? Math.min(Math.max(value, 0), max) : 0;
    const percent = known && max > 0 ? (clamped / max) * 100 : 0;
    const state = !known ? 'indeterminate' : percent >= 100 ? 'complete' : 'loading';

    return (
      <div
        {...props}
        ref={forwardedRef}
        className={clsx('lg-progress', className)}
        data-size={size}
        data-state={state}
      >
        {label || (showValue && known) ? (
          <div className="lg-progress-header">
            <span id={labelId}>{label}</span>
            {showValue && known ? (
              <span className="lg-progress-value">{Math.round(percent)}%</span>
            ) : null}
          </div>
        ) : null}
        <div
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy ?? (label ? labelId : undefined)}
          aria-valuemax={max}
          aria-valuemin={0}
          aria-valuenow={known ? clamped : undefined}
          className="lg-progress-track"
          role="progressbar"
        >
          <div
            className="lg-progress-fill"
            // SAFETY: CSSProperties has no custom-property index; this adds one number-valued property.
            style={{ '--lg-progress': percent } as CSSProperties}
          />
        </div>
      </div>
    );
  },
);

GlassProgress.displayName = 'GlassProgress';
