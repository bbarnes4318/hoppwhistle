'use client';

import { Fragment, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

import { splitHighlight } from './ui/report-helpers';

/**
 * Report V2 markdown renderer.
 *
 * The report's section markdown contains three things the default renderer
 * mishandled: GFM pipe tables (rendered as raw text), inline evidence citations
 * like `[xai-src-5]`, and search terms. This renderer:
 *   1. splits out pipe-table blocks → a styled, responsive table;
 *   2. turns `[provider-src-N]` citations into small superscript chips that can
 *      jump to the source in the evidence workspace;
 *   3. highlights the active search query.
 * No new dependency (no remark-gfm) — the table parsing is local and total.
 */

const CITE_RE = /\[([a-z]+-src-\d+)\]/gi;

/** Highlight a plain (non-markdown) value with the active search query. Every
 *  user-visible value in the report passes through this so search coverage is
 *  comprehensive and Prev/Next navigation finds it (via `data-rv-mark`). */
export function HL({ text, query }: { text: string; query?: string }): JSX.Element {
  const parts = splitHighlight(text, query ?? '');
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} data-rv-mark className="rv-mark">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}

/** Render one text string → nodes with citations chipped + search highlighted. */
function inlineText(text: string, query: string, onCite?: (id: string) => void): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const pushPlain = (s: string) => {
    if (!s) return;
    for (const part of splitHighlight(s, query)) {
      out.push(
        part.mark ? (
          <mark key={key++} data-rv-mark className="rv-mark">
            {part.text}
          </mark>
        ) : (
          <Fragment key={key++}>{part.text}</Fragment>
        )
      );
    }
  };
  text.replace(CITE_RE, (m, id: string, idx: number) => {
    pushPlain(text.slice(last, idx));
    const num = id.split('-src-')[1];
    out.push(
      <a
        key={key++}
        className="rv-cite"
        href={`#rv-source-${id}`}
        title={`Source ${id}`}
        onClick={e => {
          if (onCite) {
            e.preventDefault();
            onCite(id);
          }
        }}
      >
        {num}
      </a>
    );
    last = idx + m.length;
    return m;
  });
  pushPlain(text.slice(last));
  return out;
}

/** Render a plain value with citations chipped + search highlighted — for text
 *  that lives outside a markdown block (timeline bodies, evidence cards). */
export function Inline({ text, query = '', onCite }: { text: string; query?: string; onCite?: (id: string) => void }): JSX.Element {
  return <>{inlineText(text, query, onCite)}</>;
}

function inlineChildren(children: ReactNode, query: string, onCite?: (id: string) => void): ReactNode {
  if (typeof children === 'string') return inlineText(children, query, onCite);
  if (Array.isArray(children))
    return children.map((c, i) =>
      typeof c === 'string' ? <Fragment key={i}>{inlineText(c, query, onCite)}</Fragment> : c
    );
  return children;
}

function mdComponents(query: string, onCite?: (id: string) => void): Components {
  const wrap =
    (Tag: keyof JSX.IntrinsicElements) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ children, node, ...props }: any) => <Tag {...props}>{inlineChildren(children, query, onCite)}</Tag>;
  return {
    p: wrap('p'),
    li: wrap('li'),
    strong: wrap('strong'),
    em: wrap('em'),
    h1: wrap('h2'),
    h2: wrap('h2'),
    h3: wrap('h3'),
    h4: wrap('h4'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ children, node, ...props }: any) => (
      <a {...props} target="_blank" rel="noreferrer noopener">
        {inlineChildren(children, query, onCite)}
      </a>
    ),
  };
}

// ---- pipe-table parsing ---------------------------------------------------

interface Block {
  type: 'md' | 'table';
  lines: string[];
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');

function splitBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const tbl: string[] = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && isRow(lines[i])) {
        tbl.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'table', lines: tbl });
    } else {
      const buf: string[] = [];
      while (i < lines.length && !(isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))) {
        buf.push(lines[i]);
        i += 1;
      }
      if (buf.join('').trim()) blocks.push({ type: 'md', lines: buf });
    }
  }
  return blocks;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => c.trim());
}

function MarkdownTable({
  lines,
  query,
  onCite,
}: {
  lines: string[];
  query: string;
  onCite?: (id: string) => void;
}) {
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return (
    <div className="rv-mdtable-wrap">
      <table className="rv-table rv-mdtable">
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{inlineText(h, query, onCite)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} data-label={header[ci] ?? ''}>
                  {inlineText(c, query, onCite)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render report section markdown with tables, citations and highlighting. */
export function ReportMarkdown({
  markdown,
  query = '',
  onCite,
}: {
  markdown: string;
  query?: string;
  onCite?: (id: string) => void;
}) {
  const blocks = splitBlocks(markdown);
  const comps = mdComponents(query, onCite);
  return (
    <div className="rv-prose">
      {blocks.map((b, i) =>
        b.type === 'table' ? (
          <MarkdownTable key={i} lines={b.lines} query={query} onCite={onCite} />
        ) : (
          <ReactMarkdown key={i} components={comps}>
            {b.lines.join('\n')}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}
