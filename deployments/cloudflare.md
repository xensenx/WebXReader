# Cloudflare Pages

## Public endpoint

- URL: https://webxreader.pages.dev/
- Role: independent WebXReader mirror; no primary host is designated.

## What the repository establishes

The root README lists Cloudflare Pages as a hosted site. No dedicated Cloudflare Pages deployment workflow or equivalent Pages configuration was found among the inspected repository files. Therefore the exact connection method, production branch, build command, environment variables, preview settings and deployment triggers must be verified in the Cloudflare dashboard rather than assumed.

## Provider configuration checklist

In Cloudflare Dashboard > Workers & Pages > the WebXReader Pages project, record and verify:

1. Git repository and production branch (if using Git integration).
2. Build command, expected to be compatible with `npm run build`.
3. Build output directory, expected to be `dist`.
4. Node runtime/version and any environment variables.
5. Deployment history, preview deployments and retry/rollback controls.
6. Custom headers, redirects, cache rules and service-worker behavior.
7. Account limits and bandwidth terms relevant to the project.

These are verification items, not claims about settings already confirmed.

## Validation

Open the site, import a sample document, navigate to a hash route such as `/#/settings`, reload, and check assets and workers in browser developer tools. Inspect live response headers and compare them with the other mirrors. Check Cloudflare's deployment logs if the published revision differs from `main`.

## Recovery

For a build failure, inspect the provider build logs and compare the configured Node version and build command with [package.json](../package.json). For a stale deployment, verify the production branch and whether the provider skipped a documentation-only commit. Use the provider's deployment history for recovery; do not assume a GitHub Actions workflow exists for this mirror.
