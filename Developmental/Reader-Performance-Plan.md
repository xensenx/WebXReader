# Reader performance plan

Use cold open, rapid navigation, zoom, search, mode changes, and resume as the common scenarios. Capture first readable paint, page-turn latency, main-thread tasks over 50 ms, and canvas or image memory through a long session. Run the same scenarios on desktop, a throttled browser, and a physical low-end device when available. Use long and image-heavy documents alongside small fixtures so startup and sustained reading both get measured.

| Reader paths | First iteration | Follow-up to measure and prioritize |
| --- | --- | --- |
| DjVu | Move decoding and text search to a worker. Size only the selected page in Pages and bound raster work. | Measure zoom, fast scrubbing, scanned color pages, and worker memory over hundreds of pages. Consider region rendering for high zoom if the raster limit softens text too much. |
| PDF | Load page dimensions on demand in Pages, measure continuous layouts in batches, and cap raster size. | Measure mixed-size and scanned PDFs. Prioritize visible canvases and verify text selection and annotations at high zoom. |
| EPUB | Schedule book animation frames only when the book changes. | Profile font and image loading, pagination, and chapter changes in illustrated books. Retain nearby sections if the trace shows chapter layout dominates. |
| CBZ, CBR, CB7 | Schedule book animation on demand and use a binary lookup for the visible page. | Track extracted and decoded image memory in long archives, including right-to-left and webtoon modes. |
| TXT, MD, HTML, MHT, MOBI, AZW3, FB2, DOCX, DOC, RTF | Reuse sanitized chapter HTML across layouts. Where supported, keep one live text layout in viewport-height Pages and Book mode. Book mode has a binding, animated page turns, and a narrow-screen layout. | Trace long text, tables, code blocks, and illustrations. Introduce section-based pagination if the initial full-document layout dominates. Verify search, font changes, and bookmarks across modes. |
| ZIP and RAR | Index folders and defer live filename filtering. Nested documents use the same reader paths. | Measure large folder listings, cancelling nested opens, and gallery memory. |
| PNG and JPEG | Decode images asynchronously and ignore duplicate viewport sizes. | Profile very large images and repeated collection navigation. Verify fit, zoom, rotation, and transparency on mobile. |

Prefer changes with measurable gains in the affected reader. Keep the fixture, viewport, browser, and CPU throttle the same when comparing traces. Check saved locations, keyboard and touch controls, offline reopening, and reduced motion when changing how pages are presented.

References. [PDF.js rendering queue](https://github.com/mozilla/pdf.js/blob/master/web/pdf_rendering_queue.js) · [StPageFlip rendering loop](https://github.com/Nodlik/StPageFlip/blob/master/src/Render/Render.ts) · [Web performance guidance on animation](https://web.dev/articles/animations-guide)
