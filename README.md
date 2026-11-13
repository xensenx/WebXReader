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

Choose from any of the following sites! New updates get deployed on all 4 mirrors simultaneously. 

| Platforms hosted | Site Link |
| :--- | :--- |
| Cloudflare | [webxreader.pages.dev](https://webxreader.pages.dev/) |
| Netlify | [webxreader.netlify.app](https://webxreader.netlify.app/) |
| Firebase | [webxreader.web.app](https://webxreader.web.app/) |
| Vercel | [webxreader.vercel.app](https://webxreader.vercel.app/) |

*The primary Netlify deployment is supported by [Netlify's Open Source Program](https://www.netlify.com/open-source/).*

> [!IMPORTANT]
> Your library data is not shared between these mirrors. Each site stores books, bookmarks, reading progress, and preferences separately in your browser.
> (You can use multiple or all sites simultaneously if you want to have multiple separate libraries.)

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
