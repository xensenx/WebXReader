# Netlify

## Public endpoint

- URL: https://webxreader.netlify.app/
- Netlify's Open Source Program supports this deployment. It does not make Netlify the primary mirror.

## Repository configuration

The root [netlify.toml](../netlify.toml) declares:

- Build command: `npm run build`.
- Publish directory: `dist`.
- An ignore command using `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF` with exclusions for Markdown, `assets/`, `LICENSE` and `.gitignore`.
- HTTP response headers including Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and X-Frame-Options.

The ignore command is evaluated by Netlify in its build context. A skipped build does not necessarily mean a deployment is broken. Changes affecting the application or build configuration should be checked against this command.

## Connection and authentication

The repository contains Netlify configuration but does not by itself establish the dashboard's connected repository, production branch, access permissions, environment variables or account settings. Confirm those in Netlify's project dashboard. Do not put access tokens in this directory.

## Verification and recovery

1. Check the production deployment's commit and build log.
2. Confirm `npm run build` succeeds and `dist/` is published.
3. Test the root page, hash routes, document import, reader assets and offline behavior.
4. Check browser network responses for configured security headers and correct content types.
5. If a change was ignored unexpectedly, inspect the ignore-command diff inputs and use a supported provider redeploy.
6. If a deployment regresses, use Netlify's deployment history to inspect or restore a known-good release according to available project controls.

The application uses hash routing; no general server-side SPA rewrite is needed for its normal application routes.
