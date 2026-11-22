# Vercel

## Public endpoint

- URL: https://webxreader.vercel.app/
- Role: independent mirror.

## Repository configuration

The root [vercel.json](../vercel.json) defines:

- `ignoreCommand`: `git diff --quiet HEAD^ HEAD -- . ':!*.md' ':!assets/' ':!LICENSE' ':!.gitignore'`.
- Security headers for `/(.*)`, including Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and X-Frame-Options.

The ignore command can skip deployments for changes limited to excluded paths. Its `HEAD^` comparison should be reviewed if a commit has no parent or the provider's checkout differs from expectations.

## Provider-side settings to verify

The inspected repository does not confirm Vercel's project dashboard configuration. Verify its Git connection, production branch, framework preset, Node version, build command (`npm run build`), output directory (`dist`), environment variables and deployment protection settings. These are checks, not documented facts about the current dashboard.

## Validation and recovery

Review the deployment's source commit and build logs. Confirm the browser loads the application, that `/#/settings` works, that imports and readers load assets, and that security headers appear on the live responses. For stale content, inspect `ignoreCommand` and the provider's deployment status. Use Vercel's deployment history and supported redeploy/rollback options when necessary.
