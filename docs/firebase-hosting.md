# Firebase Hosting mirror

Cloudflare Pages remains WebXReader's primary deployment. Firebase Hosting is an independent mirror at <https://webxreader.web.app>.

## Deployment

The `Deploy Firebase Hosting mirror` GitHub Actions workflow runs only when code is pushed to `main`. It installs the locked npm dependencies, runs the existing `npm run build` command, and deploys `dist` to the already-created Hosting site `webxreader` in Firebase project `xensenx`. Feature branches and pull requests do not deploy to the live Firebase site.

The app uses React Router's `HashRouter`, so application routes live after `#` and are handled by the client. Firebase does not need a catch-all rewrite; normal static-file requests continue to resolve directly.

## One-time GitHub authorization

The repository needs an Actions secret named `FIREBASE_SERVICE_ACCOUNT`. Create a dedicated service account in Google Cloud project `xensenx` with the **Firebase Hosting Admin** role, create a JSON key for it, then add the complete JSON value under GitHub repository **Settings > Secrets and variables > Actions > New repository secret** with that exact name. Keep the downloaded key outside the repository and do not commit it.

Firebase's [GitHub Actions setup guide](https://firebase.google.com/docs/hosting/github-integration) can also create the service account and repository secret through `firebase init hosting:github`. If using that wizard, keep this repository's checked-in production workflow as the only live deploy workflow; the wizard may also generate its own workflow files.

## Rollback

To redeploy a previous source revision, revert the relevant commit on `main`; the same workflow will publish that revision. Firebase Hosting also keeps release history and supports rolling back the live release in the Firebase console under **Hosting > Release history**.
