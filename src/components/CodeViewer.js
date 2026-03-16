'use client';

import { useMemo } from 'react';

/**
 * Lightweight syntax-highlighted code viewer.
 * Regex-based highlighting for JS/TS, Python, JSON, CSS, and Markdown.
 * No external dependencies required.
 */

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Token colors
const COLORS = {
  keyword: '#c792ea',   // purple
  string: '#c3e88d',    // green
  comment: '#676e95',   // gray
  number: '#f78c6c',    // orange
  boolean: '#c792ea',   // purple
  key: '#82aaff',       // blue
  selector: '#82aaff',  // blue
  property: '#c792ea',  // purple
  value: '#c3e88d',     // green
  header: '#82aaff',    // blue
  bold: '#cdd6f4',      // light
  link: '#82aaff',      // blue
  codeBg: '#313244',    // gray bg
  plain: '#cdd6f4',     // light text
};

function span(color, text, extra = '') {
  return `<span style="color:${color}${extra}">${text}</span>`;
}

// ---- JS/TS Highlighting ----

function highlightJS(code) {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  let inBlockComment = false;

  return lines.map((line) => {
    let result = '';
    let i = 0;

    if (inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        return span(COLORS.comment, line);
      }
      result += span(COLORS.comment, line.substring(0, endIdx + 2));
      i = endIdx + 2;
      inBlockComment = false;
    }

    while (i < line.length) {
      // Block comment start
      if (line[i] === '/' && line[i + 1] === '*') {
        const endIdx = line.indexOf('*/', i + 2);
        if (endIdx === -1) {
          result += span(COLORS.comment, line.substring(i));
          inBlockComment = true;
          break;
        }
        result += span(COLORS.comment, line.substring(i, endIdx + 2));
        i = endIdx + 2;
        continue;
      }

      // Single-line comment
      if (line[i] === '/' && line[i + 1] === '/') {
        result += span(COLORS.comment, line.substring(i));
        break;
      }

      // Template literal
      if (line[i] === '`') {
        let j = i + 1;
        while (j < line.length && line[j] !== '`') {
          if (line[j] === '\\') j++;
          j++;
        }
        result += span(COLORS.string, line.substring(i, j + 1));
        i = j + 1;
        continue;
      }

      // Strings (double quote)
      if (line[i] === '&' && line.substring(i, i + 6) === '&quot;') {
        let j = i + 6;
        while (j < line.length) {
          if (line[j] === '\\') { j++; }
          else if (line.substring(j, j + 6) === '&quot;') { j += 6; break; }
          j++;
        }
        result += span(COLORS.string, line.substring(i, j));
        i = j;
        continue;
      }

      // Strings (single quote)
      if (line[i] === '&' && line.substring(i, i + 5) === '&#39;') {
        let j = i + 5;
        while (j < line.length) {
          if (line[j] === '\\') { j++; }
          else if (line.substring(j, j + 5) === '&#39;') { j += 5; break; }
          j++;
        }
        result += span(COLORS.string, line.substring(i, j));
        i = j;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=:+\-*/%[{!<>&|^~?;]/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[0-9.xXa-fA-FeEn_]/.test(line[j])) j++;
        result += span(COLORS.number, line.substring(i, j));
        i = j;
        continue;
      }

      // Keywords and identifiers
      if (/[a-zA-Z_$]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
        const word = line.substring(i, j);
        const jsKeywords = [
          'const', 'let', 'var', 'function', 'return', 'if', 'else',
          'for', 'while', 'class', 'import', 'export', 'from',
          'async', 'await', 'new', 'this', 'throw', 'try', 'catch',
          'finally', 'switch', 'case', 'break', 'continue', 'default',
          'typeof', 'instanceof', 'in', 'of', 'yield', 'delete', 'void',
          'null', 'undefined', 'true', 'false', 'extends', 'super',
        ];
        if (jsKeywords.includes(word)) {
          result += span(COLORS.keyword, word);
        } else if (word === 'true' || word === 'false') {
          result += span(COLORS.boolean, word);
        } else {
          result += word;
        }
        i = j;
        continue;
      }

      result += line[i];
      i++;
    }

    return result;
  }).join('\n');
}

// ---- Python Highlighting ----

function highlightPython(code) {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  let inMultilineStr = false;
  let multilineDelim = '';

  return lines.map((line) => {
    let result = '';
    let i = 0;

    if (inMultilineStr) {
      const endIdx = line.indexOf(multilineDelim === '"""' ? '&quot;&quot;&quot;' : '&#39;&#39;&#39;');
      if (endIdx === -1) {
        return span(COLORS.string, line);
      }
      const delimLen = multilineDelim === '"""' ? 18 : 15;
      result += span(COLORS.string, line.substring(0, endIdx + delimLen));
      i = endIdx + delimLen;
      inMultilineStr = false;
    }

    while (i < line.length) {
      // Comment
      if (line[i] === '#') {
        result += span(COLORS.comment, line.substring(i));
        break;
      }

      // Triple-quoted strings (double)
      if (line.substring(i, i + 18) === '&quot;&quot;&quot;') {
        const endIdx = line.indexOf('&quot;&quot;&quot;', i + 18);
        if (endIdx === -1) {
          result += span(COLORS.string, line.substring(i));
          inMultilineStr = true;
          multilineDelim = '"""';
          break;
        }
        result += span(COLORS.string, line.substring(i, endIdx + 18));
        i = endIdx + 18;
        continue;
      }

      // Triple-quoted strings (single)
      if (line.substring(i, i + 15) === '&#39;&#39;&#39;') {
        const endIdx = line.indexOf('&#39;&#39;&#39;', i + 15);
        if (endIdx === -1) {
          result += span(COLORS.string, line.substring(i));
          inMultilineStr = true;
          multilineDelim = "'''";
          break;
        }
        result += span(COLORS.string, line.substring(i, endIdx + 15));
        i = endIdx + 15;
        continue;
      }

      // Strings (double quote)
      if (line[i] === '&' && line.substring(i, i + 6) === '&quot;') {
        let j = i + 6;
        while (j < line.length) {
          if (line[j] === '\\') { j++; }
          else if (line.substring(j, j + 6) === '&quot;') { j += 6; break; }
          j++;
        }
        result += span(COLORS.string, line.substring(i, j));
        i = j;
        continue;
      }

      // Strings (single quote)
      if (line[i] === '&' && line.substring(i, i + 5) === '&#39;') {
        let j = i + 5;
        while (j < line.length) {
          if (line[j] === '\\') { j++; }
          else if (line.substring(j, j + 5) === '&#39;') { j += 5; break; }
          j++;
        }
        result += span(COLORS.string, line.substring(i, j));
        i = j;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=:+\-*/%[\]{!<>&|^~?;]/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[0-9.xXoOjJa-fA-Fe_]/.test(line[j])) j++;
        result += span(COLORS.number, line.substring(i, j));
        i = j;
        continue;
      }

      // Keywords and identifiers
      if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
        const word = line.substring(i, j);
        const pyKeywords = [
          'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else',
          'for', 'while', 'with', 'as', 'try', 'except', 'finally', 'raise',
          'pass', 'break', 'continue', 'and', 'or', 'not', 'is', 'in',
          'lambda', 'yield', 'global', 'nonlocal', 'assert', 'del', 'async',
          'await', 'None', 'True', 'False',
        ];
        if (pyKeywords.includes(word)) {
          result += span(COLORS.keyword, word);
        } else {
          result += word;
        }
        i = j;
        continue;
      }

      result += line[i];
      i++;
    }

    return result;
  }).join('\n');
}

// ---- JSON Highlighting ----

function highlightJSON(code) {
  const escaped = escapeHtml(code);
  // Process replacements with function callbacks to avoid regex backreference issues
  return escaped.replace(
    /(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)\s*:/g,
    (match, q1, content, q2) => `${span(COLORS.key, q1 + content + q2)}:`
  ).replace(
    /:\s*(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)/g,
    (match, q1, content, q2) => `: ${span(COLORS.string, q1 + content + q2)}`
  ).replace(
    /:\s*(-?[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?)/g,
    (match, num) => `: ${span(COLORS.number, num)}`
  ).replace(
    /:\s*(true|false)/g,
    (match, bool) => `: ${span(COLORS.boolean, bool)}`
  ).replace(
    /:\s*(null)/g,
    (match, n) => `: ${span(COLORS.keyword, n)}`
  ).replace(
    // String values in arrays
    /(\[|,)\s*(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)/g,
    (match, prefix, q1, content, q2) => `${prefix} ${span(COLORS.string, q1 + content + q2)}`
  );
}

// ---- CSS Highlighting ----

function highlightCSS(code) {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  let inBlock = false;
  let inComment = false;

  return lines.map((line) => {
    let result = '';
    let i = 0;

    if (inComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        return span(COLORS.comment, line);
      }
      result += span(COLORS.comment, line.substring(0, endIdx + 2));
      i = endIdx + 2;
      inComment = false;
    }

    while (i < line.length) {
      // Comment
      if (line[i] === '/' && line[i + 1] === '*') {
        const endIdx = line.indexOf('*/', i + 2);
        if (endIdx === -1) {
          result += span(COLORS.comment, line.substring(i));
          inComment = true;
          break;
        }
        result += span(COLORS.comment, line.substring(i, endIdx + 2));
        i = endIdx + 2;
        continue;
      }

      if (line[i] === '{') {
        inBlock = true;
        result += line[i];
        i++;
        continue;
      }

      if (line[i] === '}') {
        inBlock = false;
        result += line[i];
        i++;
        continue;
      }

      if (!inBlock) {
        // Selector line (before {)
        const remaining = line.substring(i);
        const braceIdx = remaining.indexOf('{');
        if (braceIdx !== -1) {
          result += span(COLORS.selector, remaining.substring(0, braceIdx));
          i += braceIdx;
          continue;
        }
        // Whole line is a selector continuation or @rule
        if (remaining.trim().length > 0) {
          result += span(COLORS.selector, remaining);
          break;
        }
        result += line[i];
        i++;
        continue;
      }

      // Inside block: property: value
      if (inBlock) {
        const remaining = line.substring(i);
        const colonIdx = remaining.indexOf(':');
        if (colonIdx !== -1) {
          const semicolonIdx = remaining.indexOf(';', colonIdx);
          const end = semicolonIdx !== -1 ? semicolonIdx : remaining.length;
          // Leading whitespace
          const leadingMatch = remaining.match(/^(\s*)/);
          const leading = leadingMatch ? leadingMatch[1] : '';
          const prop = remaining.substring(leading.length, colonIdx);
          const val = remaining.substring(colonIdx + 1, end);
          const semi = semicolonIdx !== -1 ? ';' : '';
          const after = remaining.substring(end + (semicolonIdx !== -1 ? 1 : 0));

          result += leading + span(COLORS.property, prop) + ':' + span(COLORS.value, val) + semi + after;
          break;
        }
        result += line[i];
        i++;
        continue;
      }

      result += line[i];
      i++;
    }

    return result;
  }).join('\n');
}

// ---- Markdown Highlighting ----

function highlightMarkdown(code) {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  let inCodeBlock = false;

  return lines.map((line) => {
    // Code block fences
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return `<span style="color:${COLORS.comment};background:${COLORS.codeBg};padding:0 4px;border-radius:2px">${line}</span>`;
    }

    if (inCodeBlock) {
      return `<span style="color:${COLORS.plain};background:${COLORS.codeBg};padding:0 4px;border-radius:2px">${line}</span>`;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s(.*)$/);
    if (headerMatch) {
      return span(COLORS.header, line, ';font-weight:bold');
    }

    let result = line;

    // Bold **text** or __text__
    result = result.replace(/(\*\*|__)(.*?)\1/g, (m, delim, text) => {
      return `<span style="font-weight:bold;color:${COLORS.bold}">${delim}${text}${delim}</span>`;
    });

    // Italic *text* or _text_ (but not inside bold)
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (m, text) => {
      return `<span style="font-style:italic">*${text}*</span>`;
    });

    // Inline code
    result = result.replace(/`([^`]+)`/g, (m, text) => {
      return `<span style="color:${COLORS.plain};background:${COLORS.codeBg};padding:0 4px;border-radius:2px">\`${text}\`</span>`;
    });

    // Links [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      return `[${span(COLORS.link, text)}](${span(COLORS.link, url)})`;
    });

    // Horizontal rules
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      return span(COLORS.comment, line);
    }

    // List markers
    result = result.replace(/^(\s*)([-*+]|\d+\.)\s/, (m, space, marker) => {
      return `${space}${span(COLORS.keyword, marker)} `;
    });

    return result;
  }).join('\n');
}

// ---- Plain text (no highlighting) ----

function highlightPlain(code) {
  return escapeHtml(code);
}

// ---- Extension to language mapping ----

function getLanguage(ext) {
  const extLower = (ext || '').toLowerCase().replace(/^\./, '');
  const map = {
    js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
    py: 'python', pyw: 'python',
    json: 'json', jsonc: 'json',
    css: 'css', scss: 'css', less: 'css',
    md: 'markdown', mdx: 'markdown',
  };
  return map[extLower] || 'plain';
}

function getHighlighter(lang) {
  switch (lang) {
    case 'js': return highlightJS;
    case 'python': return highlightPython;
    case 'json': return highlightJSON;
    case 'css': return highlightCSS;
    case 'markdown': return highlightMarkdown;
    default: return highlightPlain;
  }
}

function getExtFromPath(filePath) {
  if (!filePath) return '';
  const parts = filePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export default function CodeViewer({ content, extension, path }) {
  const ext = extension || getExtFromPath(path);
  const lang = getLanguage(ext);
  const highlight = getHighlighter(lang);

  const { highlighted, lineCount } = useMemo(() => {
    if (!content) return { highlighted: '', lineCount: 0 };
    const result = highlight(content);
    const count = content.split('\n').length;
    return { highlighted: result, lineCount: count };
  }, [content, highlight]);

  if (!content) {
    return (
      <div
        style={{
          background: '#1e1e2e',
          color: COLORS.plain,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '13px',
          padding: '16px',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: COLORS.comment }}>No content to display</span>
      </div>
    );
  }

  // Build line numbers
  const gutterWidth = String(lineCount).length * 10 + 16;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div
      style={{
        background: '#1e1e2e',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: '13px',
        lineHeight: '1.6',
        height: '100%',
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', minHeight: '100%' }}>
        {/* Line numbers gutter */}
        <div
          style={{
            width: `${gutterWidth}px`,
            minWidth: `${gutterWidth}px`,
            background: '#181825',
            borderRight: '1px solid #313244',
            padding: '16px 8px 16px 0',
            textAlign: 'right',
            color: '#585b70',
            userSelect: 'none',
            flexShrink: 0,
          }}
        >
          {lineNumbers.map((num) => (
            <div key={num}>{num}</div>
          ))}
        </div>

        {/* Code content */}
        <pre
          style={{
            margin: 0,
            padding: '16px',
            color: COLORS.plain,
            flex: 1,
            overflow: 'visible',
            whiteSpace: 'pre',
          }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>
    </div>
  );
}
