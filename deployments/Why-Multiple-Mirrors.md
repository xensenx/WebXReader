# Why Multiple Mirrors?

WebXReader is hosted across multiple independent platforms, each providing access to the same application.

While multiple mirrors are commonly used for redundancy and availability, WebXReader takes advantage of another useful characteristic: **each mirror maintains its own independent library.**

This makes multiple mirrors more than just alternative ways to access the website. They can also be used to organize different reading collections without mixing them together.

## 1. Separate Libraries for Different Purposes

WebXReader is a local-first application. Books, reading progress, bookmarks, preferences, and other library data are stored in your browser rather than on a central server.

Browsers isolate this storage by website origin. Since every WebXReader mirror uses a different domain, each one maintains its own library.

This allows you to use different mirrors for different purposes.

For example:

| Library | Suggested Content |
| --- | --- |
| College or Education | Textbooks, lecture notes, PDFs, study materials, and academic references |
| Work | Reports, professional documents, manuals, and technical documentation |
| Personal Reading | Novels, manga, comics, and ebooks |
| Research | Research papers, reference materials, and archived documents |
| Testing | Sample files, experimental collections, and format compatibility testing |

You could use the Cloudflare mirror for college materials, Netlify for novels and manga, and Firebase for work-related documents.

These are only examples. **No mirror is assigned a particular purpose**, and you are free to organize them however you prefer.

### Why Is This Useful?

Keeping different collections separate can make large libraries easier to manage.

For instance, someone who uses WebXReader for both academic reading and entertainment might prefer not to have hundreds of lecture notes mixed with their novels and manga.

By using different mirrors, they can maintain separate environments with their own books, reading progress, bookmarks, and preferences.

This requires no additional accounts, subscriptions, or configuration.

Simply open another mirror and start importing files.

### Important Limitations

The libraries are independent, not synchronized.

Books and reading progress from one mirror will not automatically appear on another. Each mirror has its own browser storage, and that storage is also specific to the browser profile and device being used.

This separation is provided by standard browser origin isolation. It is not a security boundary between people who share the same unlocked browser profile or device.

Browser storage may also be cleared or evicted, so important collections should be backed up using WebXReader's available export and backup features.

## 2. Redundancy and Availability

Even established hosting providers can experience outages, network problems, or temporary service disruptions.

Hosting WebXReader on multiple platforms reduces its dependence on any single provider.

If one mirror becomes unavailable, users can access the application through another.

However, because library data is stored separately on each origin, switching mirrors does not automatically restore the books stored on the unavailable mirror.

Multiple mirrors improve application availability, while library backups remain a separate responsibility.

## 3. Independence From Hosting Providers

WebXReader is a free and open-source project, and we want to keep its infrastructure flexible.

Relying entirely on one hosting provider creates unnecessary dependencies on that provider's pricing, policies, technical limitations, and continued availability.

By maintaining multiple deployments, WebXReader can continue operating even if an individual hosting platform becomes unsuitable.

All mirrors use the same application source code, but each is deployed independently.

No hosting provider is designated as the primary mirror.

## 4. Keeping WebXReader Free

One of WebXReader's goals is to remain free to use.

Our hosting strategy takes advantage of reputable providers that offer suitable free hosting or support for open-source projects.

Since WebXReader runs primarily in the browser, hosting generally involves serving the application's static files rather than processing users' documents on a remote server.

This makes it practical to operate across multiple hosting platforms without requiring expensive server infrastructure.

We still consider bandwidth allowances, service limitations, and hosting policies when choosing providers.

## 5. Automated Deployments

Maintaining multiple websites manually would be inconvenient and error-prone.

WebXReader avoids most of that overhead through automated deployment integrations.

Updates to the application can be built and published through the configured deployment processes for each provider.

This allows us to maintain several mirrors without manually uploading a new copy of the application every time something changes.

Deployments are independent, so updates may become available on different mirrors at slightly different times.

## 6. Compatibility Across Hosting Platforms

Different hosting providers have different infrastructure, caching behavior, security headers, and deployment environments.

Maintaining multiple mirrors also helps us identify hosting-specific compatibility issues.

For example, an application might work correctly on one provider while encountering an asset-loading, caching, or routing issue on another.

Testing across multiple environments helps us keep WebXReader portable and avoid unnecessary dependence on a particular hosting platform.

## 7. How We Choose Hosting Providers

We do not add mirrors simply to increase their number.

A hosting platform is considered based on several practical requirements:

- **Domain name:** A clean, recognizable, and suitable public URL is preferred.
- **Cost:** Hosting should be free under normal project usage or supported through an appropriate free program.
- **Automation:** The provider should support reliable automated deployments.
- **Bandwidth:** Sufficient bandwidth and resources to serve the application effectively.
- **Reputation:** An established and reasonably reliable hosting provider.
- **Compatibility:** The platform must be capable of serving WebXReader and its required static assets correctly.

Some mirrors may be more prominently advertised than others, but this does not change their role as independent deployments.

## Available Mirrors

WebXReader is currently available through the following platforms:

| Hosting Provider | Website |
| --- | --- |
| Cloudflare Pages | https://webxreader.pages.dev |
| Netlify | https://webxreader.netlify.app |
| Firebase Hosting | https://webxreader.web.app |
| Vercel | https://webxreader.vercel.app |
| Hugging Face Spaces | https://webxreader-app.static.hf.space |

All five provide access to WebXReader, but each maintains its own browser-local library.

For technical details about individual deployments, see the other documents in the `deployments/` directory.
