# Security Policy

## Architecture & Threat Model

**WebXReader** is a 100% client-side, local-first web application. All library files, reading progress, bookmarks, and preferences live exclusively inside your browser's local storage and are never transmitted to any backend server.

Because WebXReader parses and renders untrusted user-supplied files directly in the browser across 20 formats (including `HTML`, `MHT`, `EPUB`, `MD`, `DOCX`, `PDF`, `DJVU`, and nested archives like `ZIP`/`RAR`/`CB7`), our primary security focus is preventing:
- Cross-Site Scripting (XSS) via malicious markup or embedded scripts inside documents
- Sandbox escapes or unsafe DOM injection when rendering sanitized content (`dompurify`)
- Denial-of-service / memory exhaustion crashes from malformed archives or decompression bombs

---

## Supported Versions

Because WebXReader is under active development and deployed continuously across all official web mirrors (`webxreader.pages.dev`, `webxreader.netlify.app`, `webxreader.web.app`, and `webxreader.vercel.app`), only the latest commit on the `main` branch is actively supported with security updates.

| Version / Branch | Supported |
| :--- | :--- |
| `main` (Latest deployment) | :white_check_mark: |
| Older commits / forks | :x: |

---

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public GitHub issue**, as doing so could expose users to malicious file payloads before a patch is deployed.

Instead, report it privately using **GitHub Private Vulnerability Reporting**:

1. Navigate to the **[Security](https://github.com/xensenx/WebXReader/security)** tab of this repository.
2. Click **"Report a vulnerability"** (under *Advisories*) to open a private draft advisory.
3. Please include:
   - A clear description of the vulnerability and its potential impact.
   - The affected file format or component (e.g., `EPUB` parser, `MHT` renderer, archive extractor).
   - Step-by-step reproduction instructions, browser/OS details, and a minimal proof-of-concept file or payload if applicable.

---

## Response Timeline

As a solo-maintained open-source project, response times are best-effort, though security issues are prioritized:
- **Initial Acknowledgment:** Within 48 hours of submission.
- **Triage & Fix:** Confirmed vulnerabilities are patched on a private branch and rolled out simultaneously to all four production mirrors once verified.
- **Credit:** Once a fix is live, you are welcome to be credited in the published GitHub Security Advisory (or remain anonymous if you prefer).
