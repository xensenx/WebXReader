# WebXReader deployment reference

This directory documents the five independent public hosting mirrors of WebXReader, how they are deployed, and how to maintain them. It is intended for maintainers. No host is designated as the primary or authoritative deployment.

| Provider | Public URL | Deployment configuration |
| --- | --- | --- |
| Cloudflare Pages | https://webxreader.pages.dev/ | Provider-side configuration; no dedicated Pages workflow is present in this repository |
| Netlify | https://webxreader.netlify.app/ | [netlify.toml](../netlify.toml) and provider-side integration |
| Firebase Hosting | https://webxreader.web.app/ | [GitHub Actions workflow](../.github/workflows/firebase-hosting-production.yml), [firebase.json](../firebase.json), [.firebaserc](../.firebaserc) |
| Vercel | https://webxreader.vercel.app/ | [vercel.json](../vercel.json) and provider-side integration |
| Hugging Face Static Spaces | https://webxreader-app.static.hf.space/ | [GitHub Actions workflow](../.github/workflows/deploy-huggingface.yml), [deployment script](../.github/scripts/deploy-huggingface.py) |

The Netlify deployment is supported by [Netlify's Open Source Program](https://www.netlify.com/open-source/). This does not give Netlify priority over other mirrors.

## Documents

- [Architecture and dependencies](architecture.md): shared source, independent deployments, browser storage, routing and failure isolation.
- [Cloudflare Pages](cloudflare.md): confirmed public endpoint and configuration verification checklist.
- [Netlify](netlify.md): repository build and header configuration.
- [Firebase Hosting](firebase.md): workflow, Google Cloud authentication, deployment and rollback.
- [Vercel](vercel.md): repository configuration and provider settings to verify.
- [Hugging Face Spaces](huggingface.md): build publishing, token scope, inventory, routing and favicon behavior.
- [Troubleshooting and operations](troubleshooting.md): deployment checks, recovery and common issues.

## General maintenance rules

1. Treat `main` in [xensenx/WebXReader](https://github.com/xensenx/WebXReader) as the source of application code. Hosting providers serve independently built or published copies.
2. Use `npm ci` and `npm run build` for reproducible local checks; the build output is `dist/`.
3. Verify a deployment at its actual public URL. A successful build or upload does not prove that the application and all its assets work.
4. Never commit tokens, credentials, service-account keys, or private provider configuration. Document secret names and required permissions only.
5. Keep these documents aligned with the actual workflows, repository configuration, and provider dashboards. Dashboard-only settings cannot be verified from the repository alone.
6. Documentation-only changes should not require a production deployment. Confirm the actual trigger or ignore behavior of each provider before relying on that assumption.

## User data

Each mirror has a different web origin. Books, bookmarks, reading progress, settings, service-worker caches and other browser-managed data are not automatically shared between them. Opening a different mirror does not migrate the library. Users should use the application's backup/export and restore tools when moving data, where supported.
