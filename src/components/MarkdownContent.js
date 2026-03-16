'use client';

import { useMemo } from 'react';

/**
 * Lightweight inline markdown renderer.
 * Handles code blocks, inline code, bold, italic, headers, lists, and line breaks.
 * No external dependencies required.
 */

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseInline(text) {
  // Process inline markdown: bold, italic, inline code
  // Order matters: code first (to avoid processing markdown inside code),
  // then bold (** before *), then italic.
  const tokens = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code: `...`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push({ type: 'code', content: codeMatch[1] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold: **...**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      tokens.push({ type: 'bold', content: boldMatch[1] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *...*  (single asterisk, not followed by another asterisk)
    const italicMatch = remaining.match(/^\*([^*]+?)\*/);
    if (italicMatch) {
      tokens.push({ type: 'italic', content: italicMatch[1] });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Plain text: consume one character at a time until next special char
    const nextSpecial = remaining.slice(1).search(/[`*]/);
    if (nextSpecial === -1) {
      tokens.push({ type: 'text', content: remaining });
      remaining = '';
    } else {
      tokens.push({ type: 'text', content: remaining.slice(0, nextSpecial + 1) });
      remaining = remaining.slice(nextSpecial + 1);
    }
  }

  return tokens;
}

function InlineContent({ text }) {
  const tokens = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'code':
            return (
              <code
                key={i}
                style={{
                  background: 'var(--bg-tertiary)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontSize: '0.85em',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                }}
              >
                {token.content}
              </code>
            );
          case 'bold':
            return <strong key={i}>{token.content}</strong>;
          case 'italic':
            return <em key={i}>{token.content}</em>;
          default:
            return <span key={i}>{token.content}</span>;
        }
      })}
    </>
  );
}

function parseBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```...```
    const codeBlockStart = line.match(/^```(\w*)/);
    if (codeBlockStart) {
      const lang = codeBlockStart[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      // Skip the closing ```
      if (i < lines.length) i++;
      blocks.push({ type: 'codeblock', lang, content: codeLines.join('\n') });
      continue;
    }

    // Header: ## text (supports h1 through h4)
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      blocks.push({ type: 'header', level: headerMatch[1].length, content: headerMatch[2] });
      i++;
      continue;
    }

    // List item: - item or * item
    if (line.match(/^\s*[-*]\s+/)) {
      const listItems = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        const itemMatch = lines[i].match(/^\s*[-*]\s+(.*)/);
        if (itemMatch) listItems.push(itemMatch[1]);
        i++;
      }
      blocks.push({ type: 'list', items: listItems });
      continue;
    }

    // Numbered list: 1. item
    if (line.match(/^\s*\d+\.\s+/)) {
      const listItems = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        const itemMatch = lines[i].match(/^\s*\d+\.\s+(.*)/);
        if (itemMatch) listItems.push(itemMatch[1]);
        i++;
      }
      blocks.push({ type: 'ordered-list', items: listItems });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      blocks.push({ type: 'break' });
      i++;
      continue;
    }

    // Regular paragraph: collect consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,4}\s+/) &&
      !lines[i].match(/^\s*[-*]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
    }
  }

  return blocks;
}

export default function MarkdownContent({ content, className = '' }) {
  const blocks = useMemo(() => parseBlocks(content || ''), [content]);

  return (
    <div className={`markdown-content ${className}`}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'codeblock':
            return (
              <div key={i} style={{ margin: '8px 0' }}>
                {block.lang && (
                  <div
                    style={{
                      background: '#1e1e2e',
                      color: '#a6adc8',
                      padding: '4px 12px',
                      borderRadius: '8px 8px 0 0',
                      fontSize: '10px',
                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {block.lang}
                  </div>
                )}
                <pre
                  style={{
                    background: '#1e1e2e',
                    color: '#cdd6f4',
                    padding: '12px 16px',
                    borderRadius: block.lang ? '0 0 8px 8px' : '8px',
                    overflow: 'auto',
                    fontSize: '0.8em',
                    lineHeight: '1.5',
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    margin: 0,
                  }}
                >
                  <code>{block.content}</code>
                </pre>
              </div>
            );

          case 'header': {
            const sizes = { 1: '1.4em', 2: '1.2em', 3: '1.05em', 4: '0.95em' };
            return (
              <div
                key={i}
                style={{
                  fontSize: sizes[block.level] || '1em',
                  fontWeight: 600,
                  margin: '12px 0 4px 0',
                  lineHeight: '1.3',
                }}
              >
                <InlineContent text={block.content} />
              </div>
            );
          }

          case 'list':
            return (
              <ul
                key={i}
                style={{
                  margin: '6px 0',
                  paddingLeft: '20px',
                  listStyleType: 'disc',
                }}
              >
                {block.items.map((item, j) => (
                  <li key={j} style={{ margin: '2px 0', lineHeight: '1.5' }}>
                    <InlineContent text={item} />
                  </li>
                ))}
              </ul>
            );

          case 'ordered-list':
            return (
              <ol
                key={i}
                style={{
                  margin: '6px 0',
                  paddingLeft: '20px',
                  listStyleType: 'decimal',
                }}
              >
                {block.items.map((item, j) => (
                  <li key={j} style={{ margin: '2px 0', lineHeight: '1.5' }}>
                    <InlineContent text={item} />
                  </li>
                ))}
              </ol>
            );

          case 'break':
            return <div key={i} style={{ height: '8px' }} />;

          case 'paragraph':
          default:
            return (
              <p key={i} style={{ margin: '4px 0', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                <InlineContent text={block.content} />
              </p>
            );
        }
      })}
    </div>
  );
}
