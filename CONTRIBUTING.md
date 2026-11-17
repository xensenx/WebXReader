# Contributing to WebXReader

Hey, thanks for wanting to contribute to **WebXReader**! This project is actively being built with a big focus on making each of the 20 supported formats smooth, reliable, and genuinely pleasant to read right in the browser.

Whether you spotted a subtle UI quirk, want to help add new languages, or have a fix for a tricky file-parsing edge case, your help is more than welcome.

---

## Development Setup

### Prerequisites
- **Node.js** (v20 or higher recommended; v22 is used in CI)
- **Git**

### Getting It Running Locally
1. **Fork and clone** the repository:
   ```bash
   git clone [https://github.com/](https://github.com/)<your-username>/WebXReader.git
   cd WebXReader
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the dev server:**
   ```bash
   npm run dev
   ```
   Open the local URL shown in your terminal (usually `http://localhost:5173`).

---

## Available Scripts

Before opening a pull request, make sure your changes pass linting, tests, and the production TypeScript + Vite build:

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite local development server |
| `npm run lint` | Runs `oxlint` across the codebase |
| `npm test` | Runs the Vitest test suite (`vitest run`) |
| `npm run test:watch` | Runs Vitest in interactive watch mode |
| `npm run build` | Type-checks with `tsc -b` and builds the production bundle |
| `npm run preview` | Builds and serves the production bundle locally |

---

## Project Conventions & Guardrails

- **100% Local-First & Zero Tracking:** Everything runs client-side in the browser. Please don't introduce external analytics, telemetry, mandatory accounts, or third-party tracking scripts.
- **Safe File Parsing:** Many formats (`HTML`, `MHT`, `EPUB`, `MD`, `DOCX`) render user-supplied markup. Always sanitize rendered HTML with `dompurify` and stick to the existing sandboxing patterns.
- **TypeScript & Linter Rules:**
  - Keep strict TypeScript checks happy (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters` in `tsconfig.app.json`).
  - Follow the React rules in `.oxlintrc.json` (`react/rules-of-hooks`, `react/only-export-components`).
- **Tests & Fixtures:** If you fix a parser or layout issue for a specific format, adding a lightweight test case using minimal sample files in `fixtures/` is always appreciated.

---

## AI-Assisted Contributions & First-Time Contributors

Using AI coding assistants, agentic workflows, or "vibe coding" to build fixes and features is completely welcome here! Even if you don't fully understand every line of the underlying code—or if this is your very first time contributing to an external open-source repository—don't hesitate to jump in.

There is no such thing as a "wrong" implementation. Every pull request will be reviewed thoroughly, and we're happy to help refine things together. We only ask for two things:

1. **Test your changes rigorously:** Actually run the app locally (`npm run dev`), interact with the feature or format you touched across different edge cases, and verify that `npm run lint`, `npm test`, and `npm run build` all pass cleanly before opening a PR.
2. **Follow the principles in this guide:** Respect the local-first, zero-tracking, and safe-parsing guardrails outlined above (and feel free to feed this `CONTRIBUTING.md` directly into your coding agent's context so it follows them too!).

---

## Where Help Is Most Welcome

- **Format-Specific Reading Polish:** Pagination accuracy, zoom/pan behavior, table of contents extraction, and layout edge cases across our 20 supported formats (`EPUB`, `PDF`, `CBZ/CBR/CB7`, `MOBI/AZW3/FB2`, `DOCX/DOC/RTF`, `DJVU`, etc.).
- **Translations & Localization:** Adding new UI languages or improving existing translations so more people can use WebXReader in their native language.
- **Subtle UI/UX Tweaks & Bug Fixes:** Spotted a tiny layout glitch, awkward animation, or subtle interaction issue? Feel free to either open an issue to flag it or jump straight in and implement your own fix before opening a PR.
- **Documentation Fixes & Updates:** Fixing typos, clarifying guides, or improving docs as the project evolves.
- **Mobile & Accessibility Polish:** Touch gestures, responsive layouts, offline PWA quirks, and keyboard/screen-reader navigation.

*(If you're thinking about a big architectural shift or a major new feature, open an issue to chat about it first so you don't spend time building something that conflicts with planned work.)*

---

## Pull Request Workflow

1. Create a focused branch off `main` (e.g., `fix/epub-toc-links` or `feat/add-spanish-locale`).
2. Keep pull requests scoped to a single fix or improvement so they're quick and easy to review.
3. Run `npm run lint`, `npm test`, and `npm run build` locally to confirm everything passes cleanly.
4. Open a pull request against `main` with a quick summary of what changed and how you tested it.

---

## Licensing & Visual Identity

- **Source Code:** By contributing to WebXReader, you agree that your code contributions will be licensed under the **GNU Affero General Public License v3.0 (`AGPL-3.0`)** (see [`LICENSE`](LICENSE)).
- **Branding & Visual Assets:** Logos, icons, banners, and visual identity materials in `assets/` are governed separately under the **Visual Identity License (VIL) v1.0** (see [`LICENSE-BRANDING`](LICENSE-BRANDING)) and may not be redistributed or used as branding for forks or derivative projects without explicit written permission.
