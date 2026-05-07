/* ============================================================
   admin-editor-validate.js

   Pure-function validators consumed by both the form renderer and
   the commit handler. Keeping these out of the render module means
   tests can exercise Property 2 (Form validity gating) without
   touching a DOM.

   Schema shape expected here (subset of the full schema):
     {
       groups: [
         {
           name: 'listening',
           kind: 'repeating-group',
           fields: [
             { name, kind, required?, validate? (value) => string | null }
           ]
         },
         // or a direct `fields` array for non-repeating schemas
         { fields: [ ... ] }
       ]
       validate? (data) => string | null   // top-level validator
     }

   Return shape: { ok: boolean, errors: { [path]: string } }
   `path` is a dotted/bracketed locator like
   "listening[0].title" or "__root__" for top-level errors.
   The first failing field per branch short-circuits THAT branch;
   other branches are still collected.

   Validates: Requirement 4.6, 4.7, 12.1, 12.2
   ============================================================ */

(function (global) {
  'use strict';

  // Field-level: required + optional custom validator.
  function validateField(field, value, path, errors) {
    const isEmpty =
      value == null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);

    if (field.required && isEmpty) {
      errors[path] = (field.label || field.name) + ' is required.';
      return;
    }
    if (!isEmpty && typeof field.validate === 'function') {
      let msg = null;
      try {
        msg = field.validate(value);
      } catch (err) {
        msg = 'Validator threw: ' + (err && err.message ? err.message : String(err));
      }
      if (msg) errors[path] = String(msg);
    }
  }

  // Walk a repeating-group's rows (an array of objects) and validate each
  // field against each row.
  function validateRepeatingGroup(group, rows, pathPrefix, errors) {
    if (!Array.isArray(rows)) {
      errors[pathPrefix] = (group.label || group.name) + ' must be a list.';
      return;
    }
    const fields = group.fields || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      for (const field of fields) {
        const p = pathPrefix + '[' + i + '].' + field.name;
        validateField(field, row[field.name], p, errors);
      }
    }
  }

  // Top-level: walks schema.groups (each either a field container or a
  // repeating-group) against `data`, and runs any schema.validate last.
  function validate(schema, data) {
    const errors = {};
    if (!schema) return { ok: true, errors: errors };

    const groups = schema.groups || [];
    for (const group of groups) {
      if (!group) continue;

      if (group.kind === 'repeating-group') {
        const rows = data ? data[group.name] : undefined;
        validateRepeatingGroup(group, rows || [], group.name || '__group__', errors);
      } else if (Array.isArray(group.fields)) {
        for (const field of group.fields) {
          const value = data ? data[field.name] : undefined;
          validateField(field, value, field.name, errors);
        }
      }
    }

    if (typeof schema.validate === 'function') {
      let topMsg = null;
      try {
        topMsg = schema.validate(data);
      } catch (err) {
        topMsg = 'Schema validator threw: ' + (err && err.message ? err.message : String(err));
      }
      if (topMsg) errors['__root__'] = String(topMsg);
    }

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  // Convenience: true iff all required fields are filled AND every declared
  // validator passes.
  function isValid(schema, data) {
    return validate(schema, data).ok;
  }

  const api = {
    validate: validate,
    isValid: isValid,
    _validateField: validateField,
    _validateRepeatingGroup: validateRepeatingGroup,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.validate = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
