/* ============================================================
   admin-editor-test-shim.js

   Small compatibility layer so the admin-editor JS modules can be
   loaded either by the browser (as <script> tags, assigning to
   window.AdminEditor.*) or by Node.js tests (as ES modules via a
   dynamic import).

   Every production module under assets/js/admin-editor*.js follows
   the pattern:

     (function (global) {
       // ... module code ...
       const api = { foo, bar };
       if (typeof module !== 'undefined' && module.exports) {
         module.exports = api;                  // CommonJS-style (tests)
       } else {
         global.AdminEditor = global.AdminEditor || {};
         global.AdminEditor.moduleName = api;   // browser
       }
     })(typeof window !== 'undefined' ? window : globalThis);

   Tests import via the `loadModule()` helper below, which reads the
   raw file and evaluates it inside a Node vm context with a custom
   `module.exports` object. This keeps the production files free of
   Node-specific import syntax so they stay `<script>`-loadable.
   ============================================================ */

// Node-side helper — not used in the browser.
// Tests call: const diff = await loadModule('admin-editor-diff');

export async function loadModule(name) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const vm = await import('node:vm');

  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = resolve(here, `${name}.js`);
  const src = await readFile(filePath, 'utf-8');

  const sandbox = {
    module: { exports: {} },
    window: undefined,
    globalThis: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    RangeError,
    RegExp,
    Map,
    Set,
    Symbol,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: filePath });
  return sandbox.module.exports;
}
