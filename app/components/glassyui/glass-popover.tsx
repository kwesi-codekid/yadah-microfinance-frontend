'use client';

import clsx from 'clsx';
import { useTheme } from 'next-themes';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef } from 'react';
import { GlassPanel } from './glass-panel';

// From glassyui.com/components/glass-popover. Imports the `radix-ui` umbrella
// package the rest of the app uses, and hands `thickness` to the glass rather
// than leaving it to fall through onto the DOM.

const radixSlotProps = { asChild: true };

export const GlassPopover = PopoverPrimitive.Root;

export const GlassPopoverTrigger = PopoverPrimitive.Trigger;

export const GlassPopoverAnchor = PopoverPrimitive.Anchor;

export type GlassPopoverContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  /** Shadow depth. `base` is the small one, for popovers over a chart. */
  elevation?: 'base' | 'raised';
  /** How thick the glass is, as a multiple of regular. See GlassSurface. */
  thickness?: number;
};

export function GlassPopoverContent(props: GlassPopoverContentProps) {
  const { className, sideOffset = 12, elevation = 'raised', thickness, children, ...rest } = props;
  // The glass tokens default to the dark slab, and only a GlassProvider sets
  // the light one — on <html>. The app pages mount no provider, so the panel
  // carries the app's own theme itself.
  const { resolvedTheme } = useTheme();

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content sideOffset={sideOffset} {...rest} {...radixSlotProps}>
        <GlassPanel
          lens
          preset="prominent"
          variant="card"
          elevation={elevation}
          refraction="none"
          thickness={thickness}
          data-lg-theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          className={clsx('lg-popover-content', className)}
        >
          {children}
        </GlassPanel>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
