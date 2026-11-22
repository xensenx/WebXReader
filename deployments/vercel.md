# Vercel

## Public endpoint

- URL: https://webxreader.vercel.app/
- Role: independent mirror.

## Repository configuration

The root [vercel.json](../vercel.json) defines:

- `ignoreCommand`: `git diff --quiet HEAD^ HEAD -- . ':!*.md' ':!assets/' ':!LICENSE' ':!.gitignore'`.
- Security headers for `/(.*)`, including Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and X-Frame-Options.

The ignore command can skip deployments for changes limited to excluded paths. Its `HEAD^` comparison should be reviewed if a commit has no parent or the provider's checkout differs from expectations.
