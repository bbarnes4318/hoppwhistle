import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-control border border-rule-strong bg-surface px-3 py-1 text-sm text-ink shadow-card transition-[border-color,box-shadow] duration-150 ease-out ne-motion file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 [@media(pointer:coarse)]:min-h-[40px]',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
