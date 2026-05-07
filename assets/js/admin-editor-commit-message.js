/* ============================================================
   admin-editor-commit-message.js

   Commit-message composer shared by the GitHub client and the
   pre-commit confirmation UI.

   Rules (Requirement 8 + 11):
     - Schemas declare a `commitMessageTemplate` string with
       optional `{tokens}`. Tokens are substituted from the current
       form values via the schema-declared `tokens` getter (or a
       trivial field-named pick if no getter is supplied).
     - Admins can override the prefilled message entirely.
     - The final subject (text before the first blank line) is
       truncated to 72 characters; any overflow moves to the body.
     - The literal string " [via web admin]" is always appended to
       the subject. If the admin-edited message already contains it
       somewhere, the composer does NOT double-append.
     - Empty / whitespace-only messages are rejected as an error
       (caller is expected to disable the commit button when the
       composer throws).
     - The composer NEVER references the PAT, the team password,
       or any session identifier — the inputs it takes are entirely
       form values, schema templates, and admin text.

   Validates: Requirement 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 11.1, 11.3
   ============================================================ */

(function (global) {
  'use strict';

  const AUDIT_SUFFIX = ' [via web admin]';
  const MAX_SUBJECT = 72;

  function substitute(template, tokens) {
    if (!template) return '';
    return String(template).replace(/\{(\w+)\}/g, function (match, name) {
      if (tokens && Object.prototype.hasOwnProperty.call(tokens, name)) {
        return String(tokens[name]);
      }
      return match;
    });
  }

  // Extract a reasonable `{summary}` default when the schema didn't supply one.
  function defaultSummary(form, schema) {
    try {
      if (form && typeof form === 'object') {
        // Prefer title > name > first meaningful string field.
        for (const k of ['title', 'name', 'id']) {
          if (form[k] && typeof form[k] === 'string' && form[k].trim()) return form[k].trim();
        }
        for (const k of Object.keys(form)) {
          const v = form[k];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
      }
    } catch (_) { /* fall through */ }
    return schema && schema.label ? schema.label : 'update';
  }

  function buildTokens(schema, form) {
    const tokens = { summary: defaultSummary(form, schema) };
    if (schema && typeof schema.tokens === 'function') {
      try {
        const extra = schema.tokens(form) || {};
        Object.assign(tokens, extra);
      } catch (_) { /* schemas that throw are ignored */ }
    }
    if (form && typeof form === 'object') {
      // Also expose top-level string form fields as tokens so a template like
      // `content(recos): add {title}` works without the schema writing a
      // custom `tokens` function.
      for (const k of Object.keys(form)) {
        if (tokens[k] === undefined && typeof form[k] === 'string') {
          tokens[k] = form[k];
        }
      }
    }
    return tokens;
  }

  // prefill(schema, form) → the string to put in the commit message input.
  function prefill(schema, form) {
    const template = (schema && schema.commitMessageTemplate) || 'content: update';
    return substitute(template, buildTokens(schema, form));
  }

  // compose(schema, form, adminOverride) → the final message sent to GitHub.
  // Throws if the resulting subject is empty.
  function compose(schema, form, adminOverride) {
    const base = (adminOverride != null && String(adminOverride).trim())
      ? String(adminOverride)
      : prefill(schema, form);

    // Split subject vs body on the first blank line.
    const parts = String(base).split(/\n\n/);
    let subject = (parts[0] || '').trim();
    let body = parts.slice(1).join('\n\n').trim();

    if (!subject) {
      const err = new Error('Commit message required.');
      err.name = 'CommitMessageError';
      throw err;
    }

    // If the caller already included the suffix somewhere, take it as-is and
    // do NOT double-append. This makes the composer idempotent.
    const alreadyTagged = subject.includes(AUDIT_SUFFIX) || base.includes(AUDIT_SUFFIX);

    if (!alreadyTagged) {
      // Truncate subject to 72 chars BEFORE appending the suffix, moving any
      // overflow into the body.
      if (subject.length > MAX_SUBJECT) {
        // Prefer a word-boundary cut near the 72-char mark.
        const cut = subject.slice(0, MAX_SUBJECT);
        const wordCut = cut.replace(/\s+\S*$/, '');
        const finalSubject = wordCut.length > Math.floor(MAX_SUBJECT * 0.6) ? wordCut : cut;
        const overflow = subject.slice(finalSubject.length).replace(/^\s+/, '');
        subject = finalSubject;
        body = overflow + (body ? '\n\n' + body : '');
      }
      subject = subject + AUDIT_SUFFIX;
    }

    return body ? subject + '\n\n' + body : subject;
  }

  const api = {
    prefill: prefill,
    compose: compose,
    AUDIT_SUFFIX: AUDIT_SUFFIX,
    MAX_SUBJECT: MAX_SUBJECT,
    _substitute: substitute, // exported for unit tests
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.commitMessage = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
