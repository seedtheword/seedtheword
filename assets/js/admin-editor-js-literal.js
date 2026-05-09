/* ============================================================
   admin-editor-js-literal.js

   Safely read and rewrite named array/object literals inside a
   JavaScript source file without touching anything outside the
   targeted literal. Used for the two editable arrays inside
   `assets/js/showcase-carousel.js`:
     FALLBACK_SLIDES  (array of slide objects)
     DAILY_CONTENT    (object of arrays of { text, ref })

   Acorn / espree / @babel/parser were rejected at design time —
   too much bundle weight for two literals. Instead:

     1. A regex anchor locates the `const NAME = `/`let NAME = `/
        `var NAME = ` declaration.
     2. A tiny depth-counting scanner walks forward until the
        literal's outermost delimiter closes, tracking strings
        and template interpolations correctly.
     3. A tolerant JSON-ish parser converts the extracted text to
        a JS value. Accepts: JSON, single-quoted strings, unquoted
        keys, trailing commas, line/block comments. Refuses:
        template-literal interpolation, functions, regex, spread,
        computed keys, and anything else that can't round-trip
        safely. On refusal, throws JsLiteralParseError.
     4. A re-emitter produces the serialized literal text again
        using the file's captured indentation + quote style.
     5. The writer splices the new serialized text back at the
        same offsets, preserving every byte outside the literal.

   Property 1 (round-trip invariant): for any (source, name)
     where read succeeds with value v, write(source, name, v)
     produces bytes identical to source outside [start, end).

   Validates: Requirement 3.2, 4.4, 4.5
   ============================================================ */

(function (global) {
  'use strict';

  // ── Public error ──────────────────────────────────────────────────────
  function JsLiteralParseError(message) {
    this.name = 'JsLiteralParseError';
    this.message = message;
  }
  JsLiteralParseError.prototype = Object.create(Error.prototype);
  JsLiteralParseError.prototype.constructor = JsLiteralParseError;

  // ── Extraction (finds `[` or `{` slice of the named literal) ──────────
  //
  // Returns { start, end, text, style } or null if not found.
  //   start — offset in source of the OPENING delimiter
  //   end   — offset AFTER the matching closing delimiter
  //   text  — source.slice(start, end)
  //   style — { quote: "'" | '"', indent: '  ', trailingComma: boolean }
  function extract(source, literalName) {
    if (typeof source !== 'string') throw new JsLiteralParseError('source must be a string');
    if (typeof literalName !== 'string' || !literalName) throw new JsLiteralParseError('literalName required');

    const anchor = new RegExp(
      '(^|[\\n;])\\s*(?:const|let|var)\\s+' + escapeRegExp(literalName) + '\\s*=\\s*',
      'g'
    );
    const match = anchor.exec(source);
    if (!match) return null;

    // Skip past the match, then skip whitespace and comments.
    let i = match.index + match[0].length;
    i = skipWhitespaceAndComments(source, i);
    if (i >= source.length) return null;

    const opener = source[i];
    if (opener !== '[' && opener !== '{') return null;
    const closer = opener === '[' ? ']' : '}';

    // Walk forward tracking nesting.
    const end = walkDelimited(source, i);
    if (end < 0) return null;

    const text = source.slice(i, end);

    // Sniff the file's formatting style.
    const style = sniffStyle(source, text);

    return { start: i, end: end, text: text, style: style };
  }

  function walkDelimited(source, start) {
    // source[start] is '[' or '{'. Return the offset AFTER the matching
    // closer, or -1 if unbalanced or if we hit unsupported syntax.
    const stack = [];
    stack.push(source[start]);
    let i = start + 1;
    while (i < source.length) {
      const ch = source[i];
      // Skip comments and string flavors first.
      if (ch === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        i = skipString(source, i);
        continue;
      }
      if (ch === '`') {
        i = skipTemplate(source, i);
        continue;
      }
      if (ch === '[' || ch === '{' || ch === '(') {
        stack.push(ch);
        i++;
        continue;
      }
      if (ch === ']' || ch === '}' || ch === ')') {
        const want = stack[stack.length - 1];
        const match = (want === '[' && ch === ']') || (want === '{' && ch === '}') || (want === '(' && ch === ')');
        if (!match) return -1;
        stack.pop();
        i++;
        if (stack.length === 0) return i;
        continue;
      }
      i++;
    }
    return -1; // unbalanced
  }

  function skipString(source, start) {
    const q = source[start];
    let i = start + 1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === q) return i + 1;
      if (ch === '\n') return i + 1; // tolerate; extractor should have caught bad literals
      i++;
    }
    return i;
  }

  function skipTemplate(source, start) {
    // ` ... ${ ... } ... `
    let i = start + 1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') return i + 1;
      if (ch === '$' && source[i + 1] === '{') {
        // Balanced skip of the ${ ... } expression.
        let depth = 1;
        i += 2;
        while (i < source.length && depth > 0) {
          const c = source[i];
          if (c === '\\') { i += 2; continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '"' || c === "'") { i = skipString(source, i); continue; }
          else if (c === '`') { i = skipTemplate(source, i); continue; }
          i++;
        }
        continue;
      }
      i++;
    }
    return i;
  }

  function skipWhitespaceAndComments(source, i) {
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      break;
    }
    return i;
  }

  function sniffStyle(source, literalText) {
    // Indent: most-common leading whitespace inside the literal.
    const indentMatches = literalText.match(/\n([ \t]+)/g) || [];
    let indent = '  ';
    if (indentMatches.length) {
      // Prefer the SHORTEST indent (the outermost level inside the literal),
      // since nested items inherit that as a multiple.
      const first = indentMatches[0].replace('\n', '');
      indent = first || indent;
    }
    // Quote style: count single vs double in the literal body.
    let single = 0, dbl = 0;
    for (let i = 0; i < literalText.length; i++) {
      const ch = literalText[i];
      if (ch === "'") single++;
      else if (ch === '"') dbl++;
    }
    const quote = single >= dbl ? "'" : '"';
    // Trailing comma on the last element.
    const trailingComma = /,\s*[\]\}]\s*$/.test(literalText.replace(/[\s\n]+$/, ''));
    return { indent: indent, quote: quote, trailingComma: trailingComma };
  }

  // ── Tolerant parser ──────────────────────────────────────────────────
  //
  // Consumes the literal text (e.g. `[{...}, {...}]` or `{key: value}`)
  // and produces a plain JS value. Rejects any construct that can't
  // round-trip losslessly through the writer.

  function parseLiteral(text) {
    const p = { src: text, i: 0 };
    skipWs(p);
    const value = parseValue(p);
    skipWs(p);
    if (p.i < p.src.length) throw new JsLiteralParseError('trailing content after value at offset ' + p.i);
    return value;
  }

  function parseValue(p) {
    skipWs(p);
    const ch = p.src[p.i];
    if (ch === '[') return parseArray(p);
    if (ch === '{') return parseObject(p);
    if (ch === "'" || ch === '"') return parseString(p);
    if (ch === '`') throw new JsLiteralParseError('template literal at offset ' + p.i + ' (not supported)');
    if (ch === '/') throw new JsLiteralParseError('regex literal at offset ' + p.i + ' (not supported)');
    if (ch === '.' || ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber(p);
    if (p.src.startsWith('true', p.i)) { p.i += 4; return true; }
    if (p.src.startsWith('false', p.i)) { p.i += 5; return false; }
    if (p.src.startsWith('null', p.i)) { p.i += 4; return null; }
    if (p.src.startsWith('undefined', p.i)) { p.i += 9; return undefined; }
    // Spread, arrow functions, etc — refuse.
    if (p.src.startsWith('...', p.i)) throw new JsLiteralParseError('spread operator at offset ' + p.i + ' (not supported)');
    throw new JsLiteralParseError('unrecognized token at offset ' + p.i + ': ' + JSON.stringify(p.src.slice(p.i, p.i + 16)));
  }

  function parseArray(p) {
    if (p.src[p.i] !== '[') throw new JsLiteralParseError('expected [ at ' + p.i);
    p.i++;
    const out = [];
    while (true) {
      skipWs(p);
      if (p.src[p.i] === ']') { p.i++; return out; }
      out.push(parseValue(p));
      skipWs(p);
      if (p.src[p.i] === ',') { p.i++; continue; }
      if (p.src[p.i] === ']') { p.i++; return out; }
      throw new JsLiteralParseError('expected , or ] at offset ' + p.i);
    }
  }

  function parseObject(p) {
    if (p.src[p.i] !== '{') throw new JsLiteralParseError('expected { at ' + p.i);
    p.i++;
    const out = {};
    while (true) {
      skipWs(p);
      if (p.src[p.i] === '}') { p.i++; return out; }
      // Key: either a string or an unquoted identifier.
      let key;
      const kch = p.src[p.i];
      if (kch === "'" || kch === '"') {
        key = parseString(p);
      } else if (kch === '[') {
        throw new JsLiteralParseError('computed key at offset ' + p.i + ' (not supported)');
      } else if (/[A-Za-z_$]/.test(kch)) {
        let j = p.i;
        while (j < p.src.length && /[A-Za-z0-9_$]/.test(p.src[j])) j++;
        key = p.src.slice(p.i, j);
        p.i = j;
      } else {
        throw new JsLiteralParseError('unexpected key token at offset ' + p.i);
      }
      skipWs(p);
      if (p.src[p.i] !== ':') throw new JsLiteralParseError('expected : after key at offset ' + p.i);
      p.i++;
      const val = parseValue(p);
      out[key] = val;
      skipWs(p);
      if (p.src[p.i] === ',') { p.i++; continue; }
      if (p.src[p.i] === '}') { p.i++; return out; }
      throw new JsLiteralParseError('expected , or } at offset ' + p.i);
    }
  }

  function parseString(p) {
    const q = p.src[p.i];
    if (q !== "'" && q !== '"') throw new JsLiteralParseError('expected quote at offset ' + p.i);
    p.i++;
    let out = '';
    while (p.i < p.src.length) {
      const ch = p.src[p.i];
      if (ch === '\\') {
        const next = p.src[p.i + 1];
        if (next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else if (next === 'r') out += '\r';
        else if (next === '\\') out += '\\';
        else if (next === '"') out += '"';
        else if (next === "'") out += "'";
        else if (next === '`') out += '`';
        else if (next === '0') out += '\0';
        else if (next === 'u') {
          const hex = p.src.slice(p.i + 2, p.i + 6);
          out += String.fromCharCode(parseInt(hex, 16));
          p.i += 4;
        }
        else out += next;
        p.i += 2;
        continue;
      }
      if (ch === q) { p.i++; return out; }
      if (ch === '\n') throw new JsLiteralParseError('unterminated string at offset ' + p.i);
      out += ch;
      p.i++;
    }
    throw new JsLiteralParseError('unterminated string');
  }

  function parseNumber(p) {
    const start = p.i;
    if (p.src[p.i] === '-') p.i++;
    while (p.i < p.src.length && /[0-9]/.test(p.src[p.i])) p.i++;
    if (p.src[p.i] === '.') {
      p.i++;
      while (p.i < p.src.length && /[0-9]/.test(p.src[p.i])) p.i++;
    }
    if (p.src[p.i] === 'e' || p.src[p.i] === 'E') {
      p.i++;
      if (p.src[p.i] === '+' || p.src[p.i] === '-') p.i++;
      while (p.i < p.src.length && /[0-9]/.test(p.src[p.i])) p.i++;
    }
    return Number(p.src.slice(start, p.i));
  }

  function skipWs(p) {
    while (p.i < p.src.length) {
      const ch = p.src[p.i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { p.i++; continue; }
      if (ch === '/' && p.src[p.i + 1] === '/') {
        while (p.i < p.src.length && p.src[p.i] !== '\n') p.i++;
        continue;
      }
      if (ch === '/' && p.src[p.i + 1] === '*') {
        p.i += 2;
        while (p.i < p.src.length && !(p.src[p.i] === '*' && p.src[p.i + 1] === '/')) p.i++;
        p.i += 2;
        continue;
      }
      break;
    }
  }

  // ── Emitter ──────────────────────────────────────────────────────────
  //
  // serialize(value, style, nestingLevel = 0) → string
  //   style.quote         — quote flavor for strings
  //   style.indent        — one level of indent (default two spaces)
  //   style.trailingComma — put a comma after the last item in arrays/objects

  function serialize(value, style, level) {
    style = style || { quote: "'", indent: '  ', trailingComma: true };
    level = level || 0;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'string') return encodeString(value, style.quote);
    if (Array.isArray(value)) return serializeArray(value, style, level);
    if (typeof value === 'object') return serializeObject(value, style, level);
    throw new JsLiteralParseError('unsupported value type: ' + typeof value);
  }

  function serializeArray(arr, style, level) {
    if (arr.length === 0) return '[]';
    const childIndent = style.indent.repeat(level + 1);
    const closeIndent = style.indent.repeat(level);
    const parts = arr.map(function (v) { return childIndent + serialize(v, style, level + 1); });
    return '[\n' + parts.join(',\n') + (style.trailingComma ? ',' : '') + '\n' + closeIndent + ']';
  }

  function serializeObject(obj, style, level) {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    const childIndent = style.indent.repeat(level + 1);
    const closeIndent = style.indent.repeat(level);
    const parts = keys.map(function (k) {
      const keyText = isValidIdentifier(k) ? k : encodeString(k, style.quote);
      return childIndent + keyText + ': ' + serialize(obj[k], style, level + 1);
    });
    return '{\n' + parts.join(',\n') + (style.trailingComma ? ',' : '') + '\n' + closeIndent + '}';
  }

  function encodeString(s, quote) {
    // Prefer the caller's quote style; flip if doing so avoids escaping.
    const hasSingle = s.indexOf("'") >= 0;
    const hasDouble = s.indexOf('"') >= 0;
    let q = quote || "'";
    if (q === "'" && hasSingle && !hasDouble) q = '"';
    else if (q === '"' && hasDouble && !hasSingle) q = "'";
    const inner = s
      .replace(/\\/g, '\\\\')
      .replace(new RegExp(q === "'" ? "'" : '"', 'g'), '\\' + q)
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return q + inner + q;
  }

  function isValidIdentifier(s) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── Public API ──────────────────────────────────────────────────────
  // read(source, literalName) → { value, style } | null (not found)
  function read(source, literalName) {
    const ex = extract(source, literalName);
    if (!ex) return null;
    return { value: parseLiteral(ex.text), style: ex.style, start: ex.start, end: ex.end };
  }

  // write(source, literalName, newValue) → new source string with the named
  // literal rewritten. Preserves every byte outside the literal's range.
  // Throws JsLiteralParseError if the literal isn't parseable.
  function write(source, literalName, newValue) {
    const ex = extract(source, literalName);
    if (!ex) throw new JsLiteralParseError('literal ' + literalName + ' not found in source');
    // Validate parseability of the current literal first (so we refuse edits
    // on unsupported syntax rather than silently corrupting the file).
    parseLiteral(ex.text);
    // Capture the indent prefix on the anchor line so a multi-line re-emit
    // sits at the right column. For `const FOO = [ ... ]` at column 0, the
    // closing `]` should also be at column 0.
    const lineStart = source.lastIndexOf('\n', ex.start - 1) + 1;
    const anchorIndent = source.slice(lineStart, ex.start).match(/^\s*/)[0] || '';
    const style = Object.assign({}, ex.style);
    if (!style.indent || /^[ \t]*$/.test(style.indent) === false) style.indent = '  ';
    // Level 0 means no leading indent; the anchorIndent fixes up the closing delimiter.
    const emitted = serialize(newValue, style, 0);
    // Rebase the closing delimiter's indent: serialize() used level-0 which
    // means the closer sits at column 0, but the opener is at anchorIndent's
    // column. Add the anchor indent to every newline inside emitted EXCEPT
    // the first line (which starts at the anchor position).
    const rebased = emitted.replace(/\n/g, '\n' + anchorIndent);
    return source.slice(0, ex.start) + rebased + source.slice(ex.end);
  }

  const api = {
    read: read,
    write: write,
    extract: extract,
    parseLiteral: parseLiteral,
    serialize: serialize,
    JsLiteralParseError: JsLiteralParseError,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.jsLiteral = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
