/* ============================================================
   admin-editor-diff.js

   Minimal line-based diff engine for the browser admin editor.
   Zero dependencies, ~150 lines.

   Exports (both as window.AdminEditor.diff and CommonJS exports):
     diffLines(before, after) → Change[]
     formatUnified(changes)   → string
     applyUnified(before, u)  → string

   A Change is { kind: 'equal' | 'add' | 'remove', line: string }.
   Line endings are normalized to '\n' for the diff; the applier
   reconstitutes them faithfully.

   Algorithm: longest-common-subsequence via classic dynamic
   programming (O(n * m) time and space). Good enough for the
   files we edit (recommendations.json, daily-verses.json, etc.
   are well under 1000 lines). If a file ever exceeds that, we
   revisit with Myers O((n+m) * D).

   The unified-diff format used here is a simplified subset:

     --- before
     +++ after
     @@ -S,L +S,L @@
      context line (prefixed with a single space)
     -removed line
     +added line

   `applyUnified` is strict: it requires the hunk headers and
   context to match what was originally diffed, so we can
   round-trip reliably without implementing fuzz/context-healing.
   ============================================================ */

(function (global) {
  'use strict';

  function splitLines(s) {
    if (s === '' || s == null) return [];
    return String(s).split('\n');
  }

  function diffLines(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    const n = a.length;
    const m = b.length;

    // LCS table — dp[i][j] = LCS length of a[0..i) vs b[0..j).
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      dp[i] = new Int32Array(m + 1);
    }
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
      }
    }

    // Walk back to produce an edit script.
    const changes = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        changes.push({ kind: 'equal', line: a[i - 1] });
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        changes.push({ kind: 'remove', line: a[i - 1] });
        i--;
      } else {
        changes.push({ kind: 'add', line: b[j - 1] });
        j--;
      }
    }
    while (i > 0) {
      changes.push({ kind: 'remove', line: a[i - 1] });
      i--;
    }
    while (j > 0) {
      changes.push({ kind: 'add', line: b[j - 1] });
      j--;
    }
    changes.reverse();
    return changes;
  }

  // Build a unified diff string. We emit a SINGLE hunk that covers the whole
  // file — simpler to round-trip than grouping into multiple hunks with
  // context radius. The "header" line carries enough info for applyUnified
  // to validate the starting state.
  function formatUnified(changes) {
    // Count old/new lengths for the hunk header.
    let oldLen = 0;
    let newLen = 0;
    for (const c of changes) {
      if (c.kind === 'equal' || c.kind === 'remove') oldLen++;
      if (c.kind === 'equal' || c.kind === 'add') newLen++;
    }
    const oldStart = oldLen === 0 ? 0 : 1;
    const newStart = newLen === 0 ? 0 : 1;
    const out = [];
    out.push('--- before');
    out.push('+++ after');
    out.push('@@ -' + oldStart + ',' + oldLen + ' +' + newStart + ',' + newLen + ' @@');
    for (const c of changes) {
      if (c.kind === 'equal') out.push(' ' + c.line);
      else if (c.kind === 'remove') out.push('-' + c.line);
      else if (c.kind === 'add') out.push('+' + c.line);
    }
    return out.join('\n');
  }

  function applyUnified(before, unified) {
    const text = String(unified || '');
    if (text.length === 0) return before;

    const lines = text.split('\n');
    // Walk past the --- and +++ headers, find the first @@ hunk header.
    let idx = 0;
    while (idx < lines.length && !/^@@/.test(lines[idx])) idx++;
    if (idx >= lines.length) return before; // no hunk → no-op

    idx++; // skip the @@ header itself

    // Track whether the before text ended with a trailing newline so we
    // can reconstruct it. splitLines('a\n') === ['a', ''] so a trailing
    // newline shows up as a trailing empty line in the "before" array.
    const beforeLines = splitLines(before);

    const outLines = [];
    let oldCursor = 0;

    for (; idx < lines.length; idx++) {
      const ln = lines[idx];
      if (ln.length === 0) continue; // blank padding line between hunks
      const marker = ln[0];
      const payload = ln.slice(1);
      if (marker === ' ') {
        // Context — must match the current before line.
        if (beforeLines[oldCursor] !== payload) {
          throw new Error(
            'applyUnified: context mismatch at old line ' + oldCursor +
              '; expected ' + JSON.stringify(beforeLines[oldCursor]) +
              ', got ' + JSON.stringify(payload)
          );
        }
        outLines.push(payload);
        oldCursor++;
      } else if (marker === '-') {
        if (beforeLines[oldCursor] !== payload) {
          throw new Error(
            'applyUnified: remove mismatch at old line ' + oldCursor +
              '; expected ' + JSON.stringify(beforeLines[oldCursor]) +
              ', got ' + JSON.stringify(payload)
          );
        }
        oldCursor++;
      } else if (marker === '+') {
        outLines.push(payload);
      } else {
        // Unknown marker — bail.
        throw new Error('applyUnified: unknown marker ' + JSON.stringify(marker));
      }
    }

    // If there's un-consumed before tail, the diff must have covered everything.
    if (oldCursor !== beforeLines.length) {
      throw new Error(
        'applyUnified: diff did not cover all of before (' +
          oldCursor + ' of ' + beforeLines.length + ' lines consumed)'
      );
    }

    return outLines.join('\n');
  }

  const api = { diffLines: diffLines, formatUnified: formatUnified, applyUnified: applyUnified };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.diff = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
