import { useMemo, useState } from 'react';
import { Plus, Minus, FileDiff, ChevronDown, ChevronUp } from 'lucide-react';

interface FileDiffViewerProps {
  oldContent: string;
  newContent: string;
  filename?: string;
}

interface DiffLine {
  type: 'equal' | 'add' | 'remove';
  text: string;
  oldLine?: number;
  newLine?: number;
}

interface DiffChunk {
  type: 'lines' | 'collapsed';
  lines?: DiffLine[];
  count?: number;
  id?: number;
}

export function FileDiffViewer({ oldContent = '', newContent = '', filename }: FileDiffViewerProps) {
  const [expandedChunks, setExpandedChunks] = useState<Record<number, boolean>>({});

  const { diffLines, additions, deletions } = useMemo(() => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let start = 0;
    while (
      start < oldLines.length &&
      start < newLines.length &&
      oldLines[start] === newLines[start]
    ) {
      start++;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (
      oldEnd >= start &&
      newEnd >= start &&
      oldLines[oldEnd] === newLines[newEnd]
    ) {
      oldEnd--;
      newEnd--;
    }

    const result: DiffLine[] = [];
    let oldNo = 1;
    let newNo = 1;

    // Common prefix
    for (let i = 0; i < start; i++) {
      result.push({ type: 'equal', text: oldLines[i], oldLine: oldNo++, newLine: newNo++ });
    }

    // Middle changed slice
    const oldSlice = oldLines.slice(start, oldEnd + 1);
    const newSlice = newLines.slice(start, newEnd + 1);

    // Compute LCS or basic line comparison for middle slice
    if (oldSlice.length * newSlice.length < 250000) {
      const dp: number[][] = Array(oldSlice.length + 1)
        .fill(0)
        .map(() => Array(newSlice.length + 1).fill(0));

      for (let i = 1; i <= oldSlice.length; i++) {
        for (let j = 1; j <= newSlice.length; j++) {
          if (oldSlice[i - 1] === newSlice[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
      }

      let i = oldSlice.length;
      let j = newSlice.length;
      const middleDiff: DiffLine[] = [];

      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldSlice[i - 1] === newSlice[j - 1]) {
          middleDiff.push({ type: 'equal', text: oldSlice[i - 1] });
          i--;
          j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          middleDiff.push({ type: 'add', text: newSlice[j - 1] });
          j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
          middleDiff.push({ type: 'remove', text: oldSlice[i - 1] });
          i--;
        }
      }

      middleDiff.reverse();
      for (const item of middleDiff) {
        if (item.type === 'equal') {
          result.push({ ...item, oldLine: oldNo++, newLine: newNo++ });
        } else if (item.type === 'remove') {
          result.push({ ...item, oldLine: oldNo++ });
        } else {
          result.push({ ...item, newLine: newNo++ });
        }
      }
    } else {
      // Fallback for massive middle blocks
      for (const line of oldSlice) {
        result.push({ type: 'remove', text: line, oldLine: oldNo++ });
      }
      for (const line of newSlice) {
        result.push({ type: 'add', text: line, newLine: newNo++ });
      }
    }

    // Common suffix
    for (let i = newEnd + 1; i < newLines.length; i++) {
      result.push({ type: 'equal', text: newLines[i], oldLine: oldNo++, newLine: newNo++ });
    }

    let addCount = 0;
    let delCount = 0;
    for (const item of result) {
      if (item.type === 'add') addCount++;
      if (item.type === 'remove') delCount++;
    }

    return { diffLines: result, additions: addCount, deletions: delCount };
  }, [oldContent, newContent]);

  // Group equal lines into collapsed chunks if there are > 8 unchanged lines in a row
  const chunks = useMemo(() => {
    const res: DiffChunk[] = [];
    let currentLines: DiffLine[] = [];
    let chunkId = 0;

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (line.type !== 'equal') {
        if (currentLines.length > 0) {
          res.push({ type: 'lines', lines: currentLines });
          currentLines = [];
        }
        res.push({ type: 'lines', lines: [line] });
      } else {
        currentLines.push(line);
        if (currentLines.length === 10 && i + 5 < diffLines.length) {
          // Keep 3 context lines before folding
          const beforeContext = currentLines.slice(0, 3);
          res.push({ type: 'lines', lines: beforeContext });
          
          // Count how many equal lines follow
          let foldCount = 0;
          const foldLines: DiffLine[] = [];
          while (i < diffLines.length && diffLines[i].type === 'equal') {
            foldLines.push(diffLines[i]);
            foldCount++;
            i++;
          }
          // Back up by 3 for trailing context
          const trailingContext = foldLines.slice(Math.max(0, foldCount - 3));
          const collapsedBlock = foldLines.slice(0, Math.max(0, foldCount - 3));
          
          if (collapsedBlock.length > 4) {
            res.push({ type: 'collapsed', count: collapsedBlock.length, lines: collapsedBlock, id: chunkId++ });
            res.push({ type: 'lines', lines: trailingContext });
          } else {
            res.push({ type: 'lines', lines: foldLines });
          }
          i--; // adjust loop increment
          currentLines = [];
        }
      }
    }

    if (currentLines.length > 0) {
      res.push({ type: 'lines', lines: currentLines });
    }

    return res;
  }, [diffLines]);

  const toggleChunk = (id?: number) => {
    if (id === undefined) return;
    setExpandedChunks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-background/90 text-xs font-mono select-text">
      {/* ── Summary Header Bar ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/80 bg-muted/40 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 font-sans font-semibold text-foreground/90">
          <FileDiff className="w-4 h-4 text-primary inline" />
          <span>Live Diff Comparison</span>
          {filename && <span className="text-muted-foreground font-mono text-xs">({filename})</span>}
        </div>
        <div className="flex items-center gap-3 font-sans font-medium text-xs">
          <span className="flex items-center gap-1 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 px-2.5 py-0.5 rounded-full">
            <Plus className="w-3 h-3 stroke-[3]" />
            {additions} {additions === 1 ? 'addition' : 'additions'}
          </span>
          <span className="flex items-center gap-1 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 px-2.5 py-0.5 rounded-full">
            <Minus className="w-3 h-3 stroke-[3]" />
            {deletions} {deletions === 1 ? 'deletion' : 'deletions'}
          </span>
        </div>
      </div>

      {/* ── Scrollable Diff Body ── */}
      <div className="flex-1 overflow-y-auto overflow-x-auto divide-y divide-border/20">
        {chunks.map((chunk, idx) => {
          if (chunk.type === 'collapsed' && !expandedChunks[chunk.id!]) {
            return (
              <div
                key={`fold-${idx}`}
                onClick={() => toggleChunk(chunk.id)}
                className="flex items-center justify-center py-2 bg-muted/20 hover:bg-muted/50 text-muted-foreground cursor-pointer transition-colors select-none font-sans text-xs gap-2 border-y border-border/40"
              >
                <ChevronDown className="w-3.5 h-3.5 text-primary" />
                <span>Expand {chunk.count} unchanged lines</span>
                <ChevronUp className="w-3.5 h-3.5 text-primary" />
              </div>
            );
          }

          const linesToRender = chunk.type === 'collapsed' ? chunk.lines || [] : chunk.lines || [];

          return (
            <div key={`chunk-${idx}`} className="flex flex-col">
              {linesToRender.map((line, lIdx) => {
                const isAdd = line.type === 'add';
                const isRem = line.type === 'remove';

                return (
                  <div
                    key={`line-${idx}-${lIdx}`}
                    className={`flex items-stretch min-w-max hover:bg-muted/30 transition-colors ${
                      isAdd
                        ? 'bg-green-500/15 dark:bg-green-500/20 text-green-800 dark:text-green-300'
                        : isRem
                        ? 'bg-red-500/15 dark:bg-red-500/20 text-red-800 dark:text-red-300 text-opacity-90'
                        : 'text-foreground/80'
                    }`}
                  >
                    {/* Old Line Number */}
                    <div className="w-12 py-0.5 px-2 text-right text-muted-foreground/50 border-r border-border/30 select-none bg-muted/10 shrink-0">
                      {line.oldLine || ''}
                    </div>
                    {/* New Line Number */}
                    <div className="w-12 py-0.5 px-2 text-right text-muted-foreground/50 border-r border-border/30 select-none bg-muted/10 shrink-0">
                      {line.newLine || ''}
                    </div>
                    {/* Change Indicator */}
                    <div className="w-6 py-0.5 text-center select-none shrink-0 font-bold">
                      {isAdd ? '+' : isRem ? '-' : ' '}
                    </div>
                    {/* Line Content */}
                    <div className="py-0.5 pr-4 pl-1 whitespace-pre flex-1">
                      {line.text || ' '}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
