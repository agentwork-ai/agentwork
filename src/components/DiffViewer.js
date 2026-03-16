'use client';

import { useState, useMemo, useCallback } from 'react';

/**
 * Parse a unified diff string into a structured format.
 * Each file entry contains its header info and an array of hunks.
 * Each hunk has header info and an array of lines with type metadata.
 */
function parseDiff(diffStr) {
  if (!diffStr || !diffStr.trim()) return [];

  const lines = diffStr.split('\n');
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // New file diff header: diff --git a/... b/...
    if (line.startsWith('diff --git')) {
      // Extract filename from the diff header
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const fileName = match ? match[2] : line.replace('diff --git ', '');

      currentFile = {
        fileName,
        oldFileName: match ? match[1] : fileName,
        hunks: [],
        headerLines: [line],
        isNew: false,
        isDeleted: false,
        isBinary: false,
      };
      files.push(currentFile);
      currentHunk = null;
      i++;
      continue;
    }

    // File metadata lines (index, ---, +++, mode changes, etc.)
    if (currentFile && !currentHunk) {
      if (line.startsWith('index ') || line.startsWith('old mode') || line.startsWith('new mode') ||
          line.startsWith('similarity index') || line.startsWith('rename from') || line.startsWith('rename to') ||
          line.startsWith('copy from') || line.startsWith('copy to') || line.startsWith('dissimilarity index')) {
        currentFile.headerLines.push(line);
        i++;
        continue;
      }
      if (line.startsWith('new file mode')) {
        currentFile.isNew = true;
        currentFile.headerLines.push(line);
        i++;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        currentFile.isDeleted = true;
        currentFile.headerLines.push(line);
        i++;
        continue;
      }
      if (line.startsWith('Binary files')) {
        currentFile.isBinary = true;
        currentFile.headerLines.push(line);
        i++;
        continue;
      }
      if (line.startsWith('--- ')) {
        currentFile.headerLines.push(line);
        i++;
        continue;
      }
      if (line.startsWith('+++ ')) {
        currentFile.headerLines.push(line);
        i++;
        continue;
      }
    }

    // Hunk header: @@ -old,count +new,count @@
    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[3], 10);
        currentHunk = {
          header: line,
          oldStart: oldLine,
          oldCount: parseInt(hunkMatch[2] || '1', 10),
          newStart: newLine,
          newCount: parseInt(hunkMatch[4] || '1', 10),
          context: hunkMatch[5] ? hunkMatch[5].trim() : '',
          lines: [],
        };
        if (currentFile) {
          currentFile.hunks.push(currentHunk);
        }
      }
      i++;
      continue;
    }

    // Diff content lines
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.slice(1),
          oldLineNum: null,
          newLineNum: newLine,
        });
        newLine++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'remove',
          content: line.slice(1),
          oldLineNum: oldLine,
          newLineNum: null,
        });
        oldLine++;
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" — informational, render as-is
        currentHunk.lines.push({
          type: 'info',
          content: line,
          oldLineNum: null,
          newLineNum: null,
        });
      } else {
        // Context line (starts with space or is empty within a hunk)
        currentHunk.lines.push({
          type: 'context',
          content: line.length > 0 ? line.slice(1) : '',
          oldLineNum: oldLine,
          newLineNum: newLine,
        });
        oldLine++;
        newLine++;
      }
    }

    i++;
  }

  return files;
}

/**
 * Count additions and deletions for a file.
 */
function getFileStats(file) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
  }
  return { additions, deletions };
}

/**
 * DiffLine renders a single line of diff output.
 */
function DiffLine({ line }) {
  const bgColors = {
    add: 'rgba(46, 160, 67, 0.15)',
    remove: 'rgba(248, 81, 73, 0.15)',
    context: 'transparent',
    info: 'transparent',
  };

  const borderColors = {
    add: 'rgba(46, 160, 67, 0.4)',
    remove: 'rgba(248, 81, 73, 0.4)',
    context: 'transparent',
    info: 'transparent',
  };

  const textColors = {
    add: '#3fb950',
    remove: '#f85149',
    context: 'var(--text-secondary, #8b949e)',
    info: 'var(--text-tertiary, #6e7681)',
  };

  const lineNumBg = {
    add: 'rgba(46, 160, 67, 0.1)',
    remove: 'rgba(248, 81, 73, 0.1)',
    context: 'transparent',
    info: 'transparent',
  };

  const prefix = { add: '+', remove: '-', context: ' ', info: '' };

  return (
    <div
      style={{
        display: 'flex',
        background: bgColors[line.type],
        borderLeft: `3px solid ${borderColors[line.type]}`,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: '12px',
        lineHeight: '20px',
        minHeight: '20px',
      }}
    >
      {/* Old line number */}
      <div
        style={{
          width: '50px',
          minWidth: '50px',
          textAlign: 'right',
          padding: '0 8px 0 0',
          color: 'var(--text-tertiary, #6e7681)',
          userSelect: 'none',
          background: lineNumBg[line.type],
          borderRight: '1px solid var(--border-color, #30363d)',
        }}
      >
        {line.oldLineNum ?? ''}
      </div>
      {/* New line number */}
      <div
        style={{
          width: '50px',
          minWidth: '50px',
          textAlign: 'right',
          padding: '0 8px 0 0',
          color: 'var(--text-tertiary, #6e7681)',
          userSelect: 'none',
          background: lineNumBg[line.type],
          borderRight: '1px solid var(--border-color, #30363d)',
        }}
      >
        {line.newLineNum ?? ''}
      </div>
      {/* Prefix (+/-/space) */}
      <div
        style={{
          width: '18px',
          minWidth: '18px',
          textAlign: 'center',
          color: textColors[line.type],
          userSelect: 'none',
          fontWeight: 600,
        }}
      >
        {prefix[line.type]}
      </div>
      {/* Line content */}
      <div
        style={{
          flex: 1,
          padding: '0 8px 0 0',
          color: textColors[line.type],
          whiteSpace: 'pre',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {line.content}
      </div>
    </div>
  );
}

/**
 * DiffHunk renders a single hunk with its header.
 */
function DiffHunk({ hunk }) {
  return (
    <div>
      {/* Hunk header */}
      <div
        style={{
          background: 'rgba(56, 139, 253, 0.1)',
          color: 'var(--accent, #58a6ff)',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          fontSize: '12px',
          lineHeight: '20px',
          padding: '2px 12px',
          borderTop: '1px solid var(--border-color, #30363d)',
          borderBottom: '1px solid var(--border-color, #30363d)',
          userSelect: 'none',
        }}
      >
        {hunk.header}
      </div>
      {/* Lines */}
      {hunk.lines.map((line, i) => (
        <DiffLine key={i} line={line} />
      ))}
    </div>
  );
}

/**
 * DiffFile renders a single file's diff with a collapsible header.
 */
function DiffFile({ file, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const stats = useMemo(() => getFileStats(file), [file]);

  const statusLabel = file.isNew ? 'NEW' : file.isDeleted ? 'DELETED' : file.isBinary ? 'BINARY' : null;
  const statusColor = file.isNew ? '#3fb950' : file.isDeleted ? '#f85149' : '#848d97';

  return (
    <div
      style={{
        border: '1px solid var(--border-color, #30363d)',
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '12px',
        background: 'var(--bg-secondary, #161b22)',
      }}
    >
      {/* File header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'var(--bg-tertiary, #1c2128)',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: expanded ? '1px solid var(--border-color, #30363d)' : 'none',
        }}
      >
        {/* Expand/collapse chevron */}
        <span
          style={{
            display: 'inline-flex',
            transition: 'transform 0.15s ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: '12px',
            color: 'var(--text-tertiary, #6e7681)',
          }}
        >
          &#9654;
        </span>

        {/* Stats badges */}
        {stats.additions > 0 && (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#3fb950',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            }}
          >
            +{stats.additions}
          </span>
        )}
        {stats.deletions > 0 && (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#f85149',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            }}
          >
            -{stats.deletions}
          </span>
        )}

        {/* Status label */}
        {statusLabel && (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: statusColor,
              background: `${statusColor}20`,
              padding: '1px 6px',
              borderRadius: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {statusLabel}
          </span>
        )}

        {/* Filename */}
        <span
          style={{
            fontSize: '13px',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            color: 'var(--text-primary, #e6edf3)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.fileName}
        </span>
      </div>

      {/* File diff content */}
      {expanded && (
        <div style={{ overflow: 'auto' }}>
          {file.isBinary ? (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: 'var(--text-tertiary, #6e7681)',
                fontSize: '13px',
                fontStyle: 'italic',
              }}
            >
              Binary file changed
            </div>
          ) : file.hunks.length === 0 ? (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: 'var(--text-tertiary, #6e7681)',
                fontSize: '13px',
                fontStyle: 'italic',
              }}
            >
              No content changes
            </div>
          ) : (
            file.hunks.map((hunk, i) => <DiffHunk key={i} hunk={hunk} />)
          )}
        </div>
      )}
    </div>
  );
}

/**
 * DiffViewer - Main component for rendering unified diffs.
 *
 * Props:
 * - diff: string - Raw unified diff output
 * - defaultExpanded: boolean - Whether file sections start expanded (default: true)
 * - maxFiles: number - Max number of files to show initially (default: 50)
 *
 * Features #29 (Diff Viewer for File Changes) and #81 (Multi-File Diff Review)
 */
export default function DiffViewer({ diff, defaultExpanded = true, maxFiles = 50 }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [showAll, setShowAll] = useState(false);
  const [expandAll, setExpandAll] = useState(null); // null = use defaultExpanded

  const visibleFiles = showAll ? files : files.slice(0, maxFiles);
  const hasMore = files.length > maxFiles && !showAll;

  // Overall stats
  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      const s = getFileStats(file);
      additions += s.additions;
      deletions += s.deletions;
    }
    return { additions, deletions, fileCount: files.length };
  }, [files]);

  const handleExpandAll = useCallback(() => setExpandAll(true), []);
  const handleCollapseAll = useCallback(() => setExpandAll(false), []);

  if (!diff || !diff.trim()) {
    return (
      <div
        style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--text-tertiary, #6e7681)',
          fontSize: '14px',
          background: 'var(--bg-secondary, #161b22)',
          borderRadius: '8px',
          border: '1px solid var(--border-color, #30363d)',
        }}
      >
        No changes to display
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          marginBottom: '12px',
          background: 'var(--bg-tertiary, #1c2128)',
          borderRadius: '8px',
          border: '1px solid var(--border-color, #30363d)',
          fontSize: '13px',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: 'var(--text-secondary, #8b949e)' }}>
            {totalStats.fileCount} file{totalStats.fileCount !== 1 ? 's' : ''} changed
          </span>
          {totalStats.additions > 0 && (
            <span
              style={{
                color: '#3fb950',
                fontWeight: 600,
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              }}
            >
              +{totalStats.additions}
            </span>
          )}
          {totalStats.deletions > 0 && (
            <span
              style={{
                color: '#f85149',
                fontWeight: 600,
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              }}
            >
              -{totalStats.deletions}
            </span>
          )}
        </div>

        {/* Expand/Collapse controls */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleExpandAll}
            style={{
              background: 'none',
              border: '1px solid var(--border-color, #30363d)',
              color: 'var(--text-secondary, #8b949e)',
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Expand all
          </button>
          <button
            onClick={handleCollapseAll}
            style={{
              background: 'none',
              border: '1px solid var(--border-color, #30363d)',
              color: 'var(--text-secondary, #8b949e)',
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* File diffs */}
      {visibleFiles.map((file, i) => (
        <DiffFile
          key={`${file.fileName}-${i}`}
          file={file}
          defaultExpanded={expandAll !== null ? expandAll : defaultExpanded}
        />
      ))}

      {/* Show more */}
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '12px' }}>
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: 'var(--bg-tertiary, #1c2128)',
              border: '1px solid var(--border-color, #30363d)',
              color: 'var(--accent, #58a6ff)',
              padding: '6px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Show {files.length - maxFiles} more file{files.length - maxFiles !== 1 ? 's' : ''}...
          </button>
        </div>
      )}
    </div>
  );
}
