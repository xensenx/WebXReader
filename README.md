<p align="center">
  <img src="assets/icons/webxreader.svg" alt="WebXReader Logo" width="250">
</p>

<div align="center">
  <h1>WebXReader</h1>
  <p>A privacy-focused, browser-based digital library and reader.</p>
</div>

---

> [!NOTE]
> This project is still a work in progress! Many planned features are still being built. As a solo developer, I welcome any feedback or volunteer contributions!

__Current Status__: The project now supports 20 formats across document, ebook, comic, plain text, and archival formats. Individual enhancement of each format is an ongoing effort, along with further improvement of the reading experience and additional features.

---

<p align="center">
  <img src="assets/branding/wxr-banner-upscayled.webp" alt="WebXReader banner" width="1000">
</p>


WebXReader is a local-first reading application designed to help you organize, manage, and read your digital library directly in your browser. 

---

# Okay, so how can I use it? 

WebXReader is hosted on multiple platforms and has several mirrors. Here are ways you can use it:

<h5>1. Hosted sites (recommended)</h5> 

Choose from any of the following sites. Each platform deploys updates independently.

| Platforms hosted | Site Link |
| :--- | :--- |
| Cloudflare | [webxreader.pages.dev](https://webxreader.pages.dev/) |
| Netlify | [webxreader.netlify.app](https://webxreader.netlify.app/) |
| Firebase | [webxreader.web.app](https://webxreader.web.app/) |
| Vercel | [webxreader.vercel.app](https://webxreader.vercel.app/) |
| Hugging Face Spaces | [webxreader-app.static.hf.space](https://webxreader-app.static.hf.space/) |

*The primary Netlify deployment is supported by [Netlify's Open Source Program](https://www.netlify.com/open-source/).*

> [!IMPORTANT]
> Your library data is not shared between these mirrors. Each site stores books, bookmarks, reading progress, and preferences separately in your browser.
> (You can use multiple or all sites simultaneously if you want to have multiple separate libraries.)

<details>
<summary>Hugging Face mirror deployment</summary>

The **Deploy Hugging Face Spaces mirror** workflow runs on `main` pushes that change the application, public assets, build inputs, or its deployment files. Documentation-only updates skip the workflow. Once the workflow is on `main`, redeploy from **Actions** by selecting it and choosing **Run workflow** on `main`.

GitHub Actions uses Node.js 22 and `npm ci`, runs `npm run build`, and publishes the contents of `dist/` to the root of the Static HTML Space. The upload needs the repository secret `HF_TOKEN` with write access to `WebXReader/app`. The Space serves `index.html` using its README metadata. The workflow records published paths in `.webxreader-build.json` and uses that inventory to remove obsolete files on subsequent runs. Keep manually managed Space files at paths outside that inventory.

For a failed build, check the dependency and build steps in Actions. For HTTP 401, 403, or 404 during upload, check the Space path and token scope. If the Space changed during an upload, review the update and run the workflow again. After publishing, check the Space status and open the mirror directly to test reading a document and loading worker assets.

Use `/#/settings` and other hash-based routes for direct links. The Static Space returns 404 for unknown server paths such as `/settings`. Hugging Face uses its own origin for the library, settings, offline cache, and service worker. It also controls the HTTP response headers, including which custom headers a Space can set. The app needs no Firebase credentials or OAuth configuration. The mirror advertises Firebase as the canonical site in the existing page metadata.

</details>

---

<h5>2. Running Locally (Alternative)</h5>

Prefer to host it yourself? You can run WebXReader directly on your computer using the steps below. 

**Note:** Self-hosting is not recommended for most users since you won't receive automatic updates, and all official web mirrors already work offline. 
Your locally hosted setup's data is also stored separately if you decide to use both a local setup and hosted sites simultaneously. 


<details>
<summary><strong>Click here to show local setup details</strong></summary>

<br>

**Prerequisites**

- [Node.js](https://nodejs.org) (v18 or higher recommended)
- [Git](https://git-scm.com)

**Setup Steps**

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/xensenx/WebXReader](https://github.com/xensenx/WebXReader)
   cd WebXReader
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run locally (Development Mode):**
   ```bash
   npm run dev
   ```
   Open the local URL shown in your terminal (usually `http://localhost:5173`).

**Optional: Production Build**

If you want to build and serve the optimized production version (including full offline/PWA support):

```bash
npm run build
npm run preview
```

</details>


# So what can WebXReader actually do?

WebXReader is built around a simple idea: your digital library should be private, fast, and accessible anywhere without needing an account or an internet connection.

### What's working right now
* **100% Local & Private:** Your books, reading progress, and bookmarks stay directly in your browser. Nothing is ever uploaded to a server, and there are no accounts or tracking.
* **Works Completely Offline:** Once you open any mirror, you can read your entire library without an internet connection—and even install it on your device like a native app.
* **20 Formats Out of the Box:** Drop in ebooks, documents, comics, plain text, or archives directly without converting them first.
* **Tailored Reading Experiences:** Dedicated reader views and layouts designed around the type of content you're opening, with ongoing refinements to make every format feel smooth.
* **Distraction-Free Interface:** Clean, dark-mode-first design built to keep the focus on your reading rather than clutter.

<strong>Supported File Formats (20 total)</strong>

<br>

| Category | Formats |
| :--- | :--- |
| **Ebooks** | `EPUB`, `MOBI`, `AZW3`, `FB2` |
| **Documents** | `PDF`, `DOCX`, `DOC`, `RTF`, `DJVU` |
| **Comics** | `CBZ`, `CBR`, `CB7` |
| **Plain Text & Web** | `TXT`, `MD`, `HTML`, `MHT` |
| **Archives & Images** | `ZIP`, `RAR`, `PNG`, `JPEG` |
