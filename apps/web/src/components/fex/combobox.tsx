'use client';

/**
 * A search box with a list under it, done properly: `role="combobox"` on the
 * input, `role="listbox"` / `role="option"` on the list, ArrowUp/ArrowDown to
 * move, Enter to pick, Escape to close (and, pressed again, to clear).
 * `aria-activedescendant` keeps focus in the input while the highlighted
 * option is announced.
 *
 * The caller owns the query and the options; picking clears the box, because
 * every quoter combobox ADDS the picked item to a list below it.
 */

import { Search } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { CONTROL } from './parts';

export interface ComboOption {
  id: string;
  label: React.ReactNode;
  /** Shown at the right: a category, a drug class. */
  meta?: React.ReactNode;
  /** A heading the option sits under ("Conditions", "Medications"). */
  group?: string;
}

export interface ComboboxProps {
  id: string;
  label: string;
  /** Visually hidden label (the panel heading names it). */
  hideLabel?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  options: ComboOption[];
  onPick: (id: string) => void;
  placeholder?: string;
  /** Shown in the list when the query is long enough and nothing matched. */
  emptyText?: string;
  loading?: boolean;
  minChars?: number;
  className?: string;
  /** Classes for the input itself (the health search is taller than a field). */
  inputClassName?: string;
  /** A keyboard shortcut that focuses the box, shown in it while it is empty. */
  shortcut?: string;
}

export function Combobox({
  id,
  label,
  hideLabel,
  query,
  onQueryChange,
  options,
  onPick,
  placeholder,
  emptyText = 'No matches',
  loading = false,
  minChars = 1,
  className,
  inputClassName,
  shortcut,
}: ComboboxProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = `${id}-list`;
  const ready = query.trim().length >= minChars;
  const showList = open && ready;

  React.useEffect(() => setActive(0), [options]);

  const pick = (optionId: string) => {
    onPick(optionId);
    onQueryChange('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        setActive(i => Math.min(i + 1, Math.max(options.length - 1, 0)));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (showList && options[active]) {
          e.preventDefault();
          pick(options[active].id);
        }
        break;
      case 'Escape':
        if (showList) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        } else if (query) {
          e.preventDefault();
          e.stopPropagation();
          onQueryChange('');
        }
        break;
      default:
        break;
    }
  };

  const activeId = showList && options[active] ? `${id}-opt-${active}` : undefined;

  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className={cn('t-label mb-1 block text-ink-2', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
        />
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          value={query}
          placeholder={placeholder}
          onChange={e => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          aria-keyshortcuts={shortcut}
          className={cn(CONTROL, 'pl-9', shortcut && 'pr-14', inputClassName)}
        />
        {shortcut && !query ? (
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] border border-rule bg-sunken px-1 font-sans text-[10.5px] font-medium text-ink-3"
          >
            {shortcut.replace('Alt+', 'Alt ')}
          </kbd>
        ) : null}
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!showList}
        className={cn(
          'absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-rule bg-surface py-1 shadow-pop',
          'animate-in fade-in-0 duration-100 motion-reduce:animate-none'
        )}
      >
        {options.map((option, index) => (
          <React.Fragment key={option.id}>
            {option.group && option.group !== options[index - 1]?.group ? (
              <li
                role="presentation"
                className="t-label border-t border-rule px-3 pb-1 pt-2 text-ink-3 first:border-t-0"
              >
                {option.group}
              </li>
            ) : null}
            <li
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={e => {
                e.preventDefault();
                pick(option.id);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm text-ink',
                index === active && 'bg-brand-tint'
              )}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.meta ? (
                <span className="t-meta shrink-0 truncate text-ink-3">{option.meta}</span>
              ) : null}
            </li>
          </React.Fragment>
        ))}
        {loading && options.length > 0 ? (
          <li role="presentation" className="t-meta px-3 py-1.5 text-ink-3">
            Searching…
          </li>
        ) : null}
        {options.length === 0 ? (
          <li role="presentation" className="t-meta px-3 py-2 text-ink-3">
            {loading ? 'Searching…' : emptyText}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
