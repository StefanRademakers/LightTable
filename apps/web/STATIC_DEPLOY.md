# Static web deployment

Build the uploadable browser edition from the workspace root:

```sh
npm run build:web:static
```

`build_web.bat` writes to and opens `apps/web/dist-static/`. The npm command
uses `apps/web/dist/` unless `LIGHTTABLE_WEB_OUT_DIR` is set. Upload the
**contents** of the selected output directory to an HTTPS web root or
subdirectory.
The build uses relative asset URLs, so the same output works in either location.

`dist/_headers` configures the cross-origin isolation headers used by Cloudflare
Pages and Netlify. Other web servers must send the same four headers listed in
that file for every response. Without them, browser features that depend on
`SharedArrayBuffer` will not work.

The static build disables the temporary UI development tools. To deliberately
use an absolute deployment base instead, set `LIGHTTABLE_WEB_BASE` while building,
for example `/lighttable/`.
