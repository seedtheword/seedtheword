# Decap CMS attempt — archived

The files in this folder were an earlier, unfinished attempt to ship an admin
panel based on [Decap CMS](https://decapcms.org/) (formerly Netlify CMS).
That path was abandoned because Decap requires either Netlify Identity (a
service we don't use) or a Git Gateway (also a service we don't use), and
`config.yml` pointed the CMS at content paths (`site/_data/...`) that don't
exist in this repository's layout.

The superseding implementation is the **Browser Admin Editor** inside
`admin-help.html`, designed and built under
`.kiro/specs/browser-admin-editor/`. The editor commits straight to this
repository from the browser using each admin's individual fine-grained
GitHub PAT — no external CMS service, no OAuth proxy, no shared bot
account. See `.kiro/specs/browser-admin-editor/design.md` for the full
architecture.

The files in this folder are kept only as a historical record. They are not
loaded by any page on the live site. GitHub Pages now serves a 404 for the
`/admin/` path.

**Archived**: May 2026 as part of Phase C of the browser-admin-editor
rollout.
