Hugging Face mirror deployment

The **Deploy Hugging Face Spaces mirror** workflow runs on `main` pushes that change the application, public assets, build inputs, or its deployment files. Documentation-only updates skip the workflow. Once the workflow is on `main`, redeploy from **Actions** by selecting it and choosing **Run workflow** on `main`.

GitHub Actions uses Node.js 22 and `npm ci`, runs `npm run build`, and publishes the contents of `dist/` to the root of the Static HTML Space. The upload needs the repository secret `HF_TOKEN` with write access to `WebXReader/app`. The Space serves `index.html` using its README metadata. The workflow records published paths in `.webxreader-build.json` and uses that inventory to remove obsolete files on subsequent runs. Keep manually managed Space files at paths outside that inventory.

For a failed build, check the dependency and build steps in Actions. For HTTP 401, 403, or 404 during upload, check the Space path and token scope. If the Space changed during an upload, review the update and run the workflow again. After publishing, check the Space status and open the mirror directly to test reading a document and loading worker assets.

Use `/#/settings` and other hash-based routes for direct links. The Static Space returns 404 for unknown server paths such as `/settings`. Hugging Face uses its own origin for the library, settings, offline cache, and service worker. It also controls the HTTP response headers, including which custom headers a Space can set. The app needs no Firebase credentials or OAuth configuration. The mirror advertises Firebase as the canonical site in the existing page metadata.
