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

*The Netlify deployment is supported by [Netlify's Open Source Program.](https://www.netlify.com/open-source/).*

Maintainer documentation for all five mirrors is available in the [deployment reference](deployments/README.md).

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


## So what can WebXReader actually do?

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


## License

WebXReader is free and open-source software licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](./LICENSE) for details.

### Branding and Visual Identity

The **WebXReader** name, original logos, icons, and other designated visual identity assets are separately protected and are not licensed under the AGPL-3.0.

You are welcome to fork, modify, and redistribute WebXReader under the terms of the AGPL-3.0. However, independent distributions must follow the branding requirements described in [LICENSE-BRANDING](./LICENSE-BRANDING.md), including replacing protected branding where required.

This distinction allows the software to remain open source while preserving the identity of the official WebXReader project.

## Support

The best way to support WebXReader is by actually using it!

If you'd like to help the project grow, here are a few other ways:

- **Star the repository** to help more people discover WebXReader.
- **Share WebXReader** with friends, family, or anyone who might find it useful.
- **Report bugs or suggest features** through [GitHub Issues](https://github.com/xensenx/WebXReader/issues).
- **Contribute to development** by reading our [Contributing Guide](./CONTRIBUTING.md).

### Financial Support

WebXReader is completely free and open source, and donations are entirely optional.

If you'd like to support its continued development, you can do so through Ko-fi.

<p align="left">
  <a href="https://ko-fi.com/xensenx" target="_blank" rel="noopener noreferrer">
    <img src="assets/icons/ko-fi-svgrepo-com.svg" alt="Support WebXReader on Ko-fi" width="150">
  </a>
</p>

Every contribution is appreciated, but simply using and sharing WebXReader is already a great way to help.

## Contact

Have a question, suggestion, or feedback? Feel free to get in touch.

**Bug Reports & Feature Requests:** [Open an issue on GitHub](https://github.com/xensenx/WebXReader/issues) so we can track and address it.
**General Inquiries:** For other questions, collaboration, or private matters, contact me at **xensenx.dev@gmail.com** or use the [contact form](https://xensenx.dev/contact/).


