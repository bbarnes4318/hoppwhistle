'use client';

import { Fragment, type ReactNode } from 'react';
import type { Components } from 'react-markdown';

import { splitHighlight } from './report-helpers';

/** Render a plain string with case-insensitive matches wrapped in <mark>.
 *  Pure React (no dangerouslySetInnerHTML) → safe against HTML injection. */
export function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const parts = splitHighlight(text, query);
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} data-ir-mark className="ir-mark">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}

// Recursively highlight only the STRING children; nested elements are handled by
// their own component override, so highlighting composes through the tree.
function hl(children: ReactNode, query: string): ReactNode {
  if (!query) return children;
  if (typeof children === 'string') return <Highlight text={children} query={query} />;
  if (Array.isArray(children))
    return children.map((c, i) =>
      typeof c === 'string' ? <Highlight key={i} text={c} query={query} /> : c
    );
  return children;
}

/**
 * react-markdown component overrides that highlight matching text inside the
 * rendered report body. Every text-bearing element runs its string children
 * through the safe highlighter.
 */
export function highlightMarkdownComponents(query: string): Components {
  const wrap =
    (Tag: keyof JSX.IntrinsicElements) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ children, ...props }: any) => <Tag {...props}>{hl(children, query)}</Tag>;
  return {
    p: wrap('p'),
    li: wrap('li'),
    strong: wrap('strong'),
    em: wrap('em'),
    h1: wrap('h1'),
    h2: wrap('h2'),
    h3: wrap('h3'),
    h4: wrap('h4'),
    td: wrap('td'),
    th: wrap('th'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ children, ...props }: any) => (
      <a {...props} target="_blank" rel="noreferrer noopener">
        {hl(children, query)}
      </a>
    ),
  };
}
