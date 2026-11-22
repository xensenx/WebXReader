# Firebase Hosting

## Public endpoint and project

- URL: https://webxreader.web.app/
- Firebase project: `xensenx`.
- Hosting target and site: `webxreader`.
- Role: independent mirror; no primary host is designated.

The repository maps this target in [.firebaserc](../.firebaserc). [firebase.json](../firebase.json) publishes `dist/`, excludes Firebase configuration, hidden files and `node_modules`, and configures security response headers.

## Production workflow

[.github/workflows/firebase-hosting-production.yml](../.github/workflows/firebase-hosting-production.yml) is named `Deploy Firebase Hosting mirror`.

- Runs on pushes to `main`.
- Ignores Markdown files, `assets/**`, `LICENSE` and `.gitignore` for trigger purposes.
- Grants `contents: read` and `id-token: write`.
- Uses Ubuntu, Node.js 22, `npm ci`, and `npm run build`.
- Installs `firebase-tools`, authenticates to Google Cloud, and executes `firebase deploy --only hosting:webxreader --project xensenx --non-interactive`.
- Uses the `firebase-hosting-production` concurrency group and cancels superseded runs.

The workflow does not declare a manual `workflow_dispatch` trigger. A documentation-only commit may not trigger it.

## Authentication

The workflow uses [google-github-actions/auth](https://github.com/google-github-actions/auth) with Workload Identity Federation rather than a stored service-account JSON key.

- Workload identity provider: `projects/1000429566837/locations/global/workloadIdentityPools/github-actions/providers/github`.
- Service account: `firebase-hosting-deployer@xensenx.iam.gserviceaccount.com`.
- Project ID: `xensenx`.

The Google Cloud pool, provider, repository/ref condition and `roles/iam.workloadIdentityUser` binding are managed outside this repository. GitHub Actions must be permitted to issue OIDC tokens. The auth action provides short-lived credentials to the Firebase CLI. Do not create or commit a long-lived service-account key for this workflow.

## Routing, validation and recovery

WebXReader uses `HashRouter`; a route such as `/#/settings` does not require a catch-all Hosting rewrite. Validate the deployed root page, a hash route, file import, reader assets and live response headers.

For deployment failures, inspect the GitHub Actions run. Authentication errors should be investigated through the WIF provider, service-account permissions, OIDC policy and Firebase project/target mapping. Build failures should be reproduced with `npm ci` and `npm run build`.

To restore a known-good release, review Firebase Hosting release history in the Firebase console. Reverting the source change on `main` can also publish a previous code state through the normal workflow when its trigger conditions are met.
