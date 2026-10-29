# Firebase Hosting mirror

Cloudflare Pages remains WebXReader's primary deployment. Firebase Hosting is an independent mirror at <https://webxreader.web.app>.

## Deployment

The `Deploy Firebase Hosting mirror` GitHub Actions workflow runs only when code is pushed to `main`. It installs the locked npm dependencies, runs the existing `npm run build` command, and deploys `dist` to the already-created Hosting site `webxreader` in Firebase project `xensenx`. Feature branches and pull requests do not deploy to the live Firebase site.

The app uses React Router's `HashRouter`, so application routes live after `#` and are handled by the client. Firebase does not need a catch-all rewrite; normal static-file requests continue to resolve directly.

## GitHub authentication

The workflow uses [Google's GitHub Actions auth action](https://github.com/google-github-actions/auth) with Workload Identity Federation (WIF) to impersonate the existing service account. It uses provider `projects/1000429566837/locations/global/workloadIdentityPools/github-actions/providers/github` and service account `firebase-hosting-deployer@xensenx.iam.gserviceaccount.com`. The Google Cloud pool, provider, repository/ref attribute condition, and service-account `roles/iam.workloadIdentityUser` binding are provisioned separately in project `xensenx`.

The workflow grants `contents: read` and `id-token: write`. GitHub Actions must be enabled for the repository and allowed to request OIDC tokens. No repository secret or variable is required; in particular, do not add a service-account JSON key. The auth action creates short-lived Application Default Credentials for the Firebase CLI, which deploys only `hosting:webxreader` to project `xensenx`.

## Rollback

To redeploy a previous source revision, revert the relevant commit on `main`; the same workflow will publish that revision. Firebase Hosting also keeps release history and supports rolling back the live release in the Firebase console under **Hosting > Release history**.
