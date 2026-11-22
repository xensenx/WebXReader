# Hugging Face Static Spaces

## Public endpoint and Space

- URL: https://webxreader-app.static.hf.space/
- Space repository: https://huggingface.co/spaces/WebXReader/app
- Space identifier: `WebXReader/app`
- SDK: Static HTML (`static`).
- Role: independent mirror; no primary host is designated.

The actual static hostname includes `.static.hf.space`. Do not substitute `webxreader-app.hf.space` without verifying that URL separately.

## GitHub Actions workflow

[.github/workflows/deploy-huggingface.yml](../.github/workflows/deploy-huggingface.yml) is named `Deploy Hugging Face Spaces mirror`.

- Runs on relevant `main` pushes affecting `src/`, `public/`, build inputs, and the deployment script/workflow.
- Also supports manual `workflow_dispatch` on `main`.
- Ignores unrelated documentation-only changes by using an explicit path allowlist.
- Uses Ubuntu, Node.js 22, `npm ci`, `npm run build`, Python 3.12 and pinned `huggingface_hub==2.4.0`.
- Runs `python .github/scripts/deploy-huggingface.py dist "$(git rev-parse HEAD)"`.
- Grants the job `contents: read` and passes the `HF_TOKEN` repository secret only to the publishing step.
- Uses a concurrency group that cancels superseded production runs.

The `HF_TOKEN` secret must grant write access to `WebXReader/app`. Do not place its value in Markdown, workflow logs or source files.

## Publishing and file ownership

[.github/scripts/deploy-huggingface.py](../.github/scripts/deploy-huggingface.py) checks that `dist/` exists, contains a nonempty `index.html`, has no symlinks, and does not use reserved paths. It reads the Space's current repository state and metadata, ensures the Space uses the static SDK, and sets the app entry point to `index.html`.

The script uploads the build files and updates the Space README and `.webxreader-build.json` inventory in a single `create_commit` call. The inventory records paths managed by the deployment. Files that were managed previously but no longer appear in the new build are deleted. Paths outside the inventory are treated as unmanaged, and collisions with them block publishing.

On first deployment, the script recognizes known starter-template files by their blob hashes. It uses the current Space commit as the expected parent, so concurrent changes can cause the deployment to fail instead of silently overwriting another update.

Do not manually edit build-managed files in the Space repository. Keep manual content at non-conflicting paths and inspect the inventory before changing the script's cleanup behavior.

## Routing, favicon and origin behavior

Use hash routes such as `/#/settings`. Static Spaces can return 404 for unknown server paths such as `/settings`.

Hugging Face may serve its own logo at the conventional `/favicon.ico` path even when the Space contains WebXReader's ICO. The application previously referenced this legacy path; the favicon fix removed that reference so browsers can select the existing SVG/PNG favicon declarations. If the Hugging Face icon returns, inspect the live HTML `<head>`, requested icon URL, browser cache and response content rather than assuming custom icons are prohibited.

The Space is a distinct browser origin with its own library data, service-worker scope and cache. It does not need Firebase authentication or Google Cloud credentials. Response headers are controlled by the hosting environment; do not assume that Netlify/Vercel/Firebase header configuration applies here.

## Failure and recovery

- Build failure: check `npm ci`, TypeScript/Vite output and GitHub Actions logs.
- Missing token or HTTP 401/403/404: verify `HF_TOKEN`, its Space write scope and the Space identifier.
- Concurrent update rejection: inspect the current Space state, then rerun the workflow.
- Inventory error or unmanaged-file collision: inspect the Space repository and resolve the discrepancy deliberately; do not delete files blindly.
- Missing assets: inspect the deployed `index.html`, asset paths, inventory and Space commit.
- Incorrect favicon: inspect `/favicon.ico` versus the SVG/PNG links and verify in a fresh browser session.

After a successful upload, open the actual static hostname and test a document import, reader assets, navigation and offline behavior. A successful commit does not alone establish end-to-end correctness.
