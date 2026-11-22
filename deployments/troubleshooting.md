# Deployment operations and troubleshooting

## Release verification checklist

For every mirror affected by a release:

1. Confirm the deployment references the intended `main` revision.
2. Open its public URL and check that the application renders without console errors.
3. Open `/#/settings` directly and reload; avoid assuming `/settings` is a valid server route.
4. Import and open a representative supported document. Check network requests for parser, worker and other dynamically loaded assets.
5. Verify that icons, manifest and content types are correct.
6. Check the service worker and offline app shell where supported.
7. Inspect CSP and other security response headers at the live origin.
8. Test browser storage independently on that origin; do not assume another mirror's library will appear.

## Where to look first

| Symptom | First checks |
| --- | --- |
| GitHub Actions build failed | Workflow logs; `npm ci`; `npm run build`; Node version |
| Provider build did not run | Production branch; provider-side Git integration; path filters and ignore commands |
| Firebase authentication failed | GitHub OIDC permissions; Google WIF provider, binding and service account; project/target |
| Hugging Face upload failed | `HF_TOKEN` scope; Space ID; inventory/collision errors; concurrent commit |
| Page loads but assets fail | Network tab; public asset paths; MIME types; CSP; published `dist/` |
| Direct URL returns 404 | Check whether the URL needs a hash route such as `/#/settings` |
| Hugging Face logo appears in tab | Inspect favicon links; Hugging Face's `/favicon.ico` response; cached favicon |
| Different books or settings on mirrors | Expected origin-isolated browser storage; use app export/restore where supported |
| Stale application after deploy | Deployment revision; browser cache/service worker; provider cache; skipped deployment |
| One mirror behaves differently | Compare provider headers, routing, asset serving, caching and deployment revision |

## Deployment triggers

- Firebase: [workflow](../.github/workflows/firebase-hosting-production.yml) runs on `main` pushes with a `paths-ignore` list; no manual dispatch is declared.
- Hugging Face: [workflow](../.github/workflows/deploy-huggingface.yml) runs on selected `main` paths and supports manual dispatch.
- Netlify: [netlify.toml](../netlify.toml) declares an ignore command; verify provider-side Git settings.
- Vercel: [vercel.json](../vercel.json) declares an ignore command; verify provider-side Git settings.
- Cloudflare: inspect the Pages dashboard for the connection and deployment triggers; no dedicated repository workflow was identified.

A Markdown-only documentation change may be ignored by some deployment systems. This is expected when no application assets need to change.

## Rollback principles

Identify the failing revision and determine whether the issue is shared application code or provider-specific configuration. For an application regression, revert or fix the source and allow each mirror to deploy the corrected revision. For a provider-only problem, inspect that provider's deployment history and supported rollback/redeploy controls. Firebase Hosting maintains release history; other provider controls must be verified in their dashboards.

Avoid modifying browser-stored user data as part of a hosting rollback. Deploying an older app version does not automatically roll back IndexedDB data or service-worker caches.

## Keeping documentation current

When changing a workflow, publishing script, build configuration, host URL or authentication method, update the matching provider page and [architecture.md](architecture.md). Document dashboard-only changes explicitly as verified or unverified. Never store secrets or access tokens in this directory.
