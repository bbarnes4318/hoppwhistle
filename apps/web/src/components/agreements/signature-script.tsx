import '@fontsource/dancing-script/400.css';

import { cn } from '@/lib/utils';

/**
 * A typed signature in the script the executed agreements use (Dancing Script,
 * self-hosted from @fontsource, SIL Open Font License). What is previewed here
 * is what the PDF prints.
 */
export function SignatureScript({
  name,
  className,
}: {
  name: string;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap text-[30px] leading-none text-[#0f2a4a]',
        className
      )}
      style={{ fontFamily: "'Dancing Script', cursive" }}
    >
      {name || ' '}
    </span>
  );
}
