/* ============================================================
   admin-editor-test-shim.js

   Small compatibility layer so the admin-editor JS modules can be
   loaded either by the browser (as <script> tags, assigning to
   window.AdminEditor.*) or by Node.js tests (as dynamic imports).

   Every production module under assets/js/admin-editor*.js follows
   the IIFE pattern:

     (function (global) {
       // ... module code ...
       const api = { foo, bar };
       if (typeof module !== 'undefined' && module.exports) {
         module.exports = api;                  // tests (this loader)
       } else {
         global.AdminEditor = global.AdminEditor || {};
         global.AdminEditor.moduleName = api;   // browser
       }
     })(typeof window !== 'undefined' ? window : globalThis);

   `loadModule(name)` reads the file and wraps it in `new Function`
   so it evaluates with Node's real globals available (Buffer, btoa,
   atob, setTimeout, etc.) without needing to enumerate them.
   This is simpler and safer than vm.createContext, which does not
   inherit the parent realm's built-ins.
   ============================================================ */

export async function loadModule(name) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');

  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = resolve(here, `${name}.js`);
  const src = await readFile(filePath, 'utf-8');

  // The production files close over `(typeof window !== 'undefined' ? window : globalThis)`.
  // Under `new Function`, `globalThis` is the real Node globalThis, which is
  // a live object — so any assignment the module makes to
  // `globalThis.AdminEditor.foo` persists across calls. We reset it each load
  // to avoid cross-test pollution.
  delete globalThis.AdminEditor;

  // Wrap so `module.exports = api;` works inside the production IIFE.
  const wrapped = `
    "use strict";
    const module = { exports: {} };
    ${src}
    ;return module.exports;
  `;
  const fn = new Function(wrapped);
  return fn();
}
