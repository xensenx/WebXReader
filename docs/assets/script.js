/* =============================================================
   WebXReader Documentation — site runtime
   Builds the navigation shell (topbar, sidebar, page TOC,
   prev/next pager, footer) from the PAGES map below, then wires
   up theming, client-side search, code highlighting and copy
   buttons. No build step, no dependencies.
   ============================================================= */
(function () {
  'use strict';

  /* ---------- Icons (inline SVG, feather-style) ---------- */
  var I = {
    book: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    rocket: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
    layers: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 8.5 4.9L12 11.8 3.5 6.9Z"/><path d="m3.5 12 8.5 4.9 8.5-4.9"/><path d="m3.5 17.1 8.5 4.9 8.5-4.9"/></svg>',
    database: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
    file: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg>',
    bookOpen: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>',
    grid: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    swap: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>',
    flask: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>',
    upload: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
    cloud: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>',
    map: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6-6 3v13l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 6v13"/><path d="M15 9v13"/></svg>',
    sun: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.3 11.3 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    menu: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    github: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.02 1.76 2.68 1.25 3.34.96.1-.75.4-1.26.72-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.77 1.05.77 2.13v3.16c0 .3.21.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>',
    external: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    copy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>',
    tip: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M9 20v-4a6 6 0 0 1-4-5.7C5 7 8 4 12 4s7 3 7 6.3A6 6 0 0 1 15 16v4"/></svg>',
    warn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4m0 4h.01"/></svg>'
  };

  /* ---------- Page registry (order = reading order) ---------- */
  var PAGES = [
    { id: 'index',            file: 'index.html',             title: 'Home & Overview',            short: 'Home',            icon: 'book',       group: 'Introduction', desc: 'What WebXReader is, key facts, and a map of these docs.' },
    { id: 'getting-started',  file: 'getting-started.html',   title: 'Getting Started',            short: 'Getting Started', icon: 'rocket',     group: 'Introduction', desc: 'Prerequisites, running, building and linting the project.' },
    { id: 'architecture',     file: 'architecture.html',      title: 'Architecture',               short: 'Architecture',    icon: 'layers',     group: 'Core',         desc: 'Tech stack, folder layout, routing, state and rendering flow.' },
    { id: 'data-model',       file: 'data-model.html',        title: 'Data Model',                 short: 'Data Model',      icon: 'database',   group: 'Core',         desc: 'Every type and interface in src/types/book.ts, with defaults.' },
    { id: 'formats',          file: 'formats.html',           title: 'Formats & Parsers',          short: 'Formats',         icon: 'file',       group: 'Core',         desc: 'The format registry, per-format definitions and parsers.' },
    { id: 'reader',           file: 'reader.html',            title: 'Reader Engine',              short: 'Reader',          icon: 'bookOpen',   group: 'Core',         desc: 'ReaderView, format engines, zoom, progress and shortcuts.' },
    { id: 'library',          file: 'library.html',           title: 'Library & Metadata',         short: 'Library',         icon: 'grid',       group: 'Core',         desc: 'LibraryView, drag ordering, filters, covers and details editor.' },
    { id: 'storage',          file: 'storage.html',           title: 'Storage & Persistence',      short: 'Storage',         icon: 'database',   group: 'Core',         desc: 'IndexedDB schema, store API, settings and per-book settings.' },
    { id: 'import-export',    file: 'import-export.html',     title: 'Import & Backup',            short: 'Import / Export', icon: 'swap',       group: 'Core',         desc: 'Import pipeline, dedup hashing, backup v1/v2 and restore.' },
    { id: 'testing',          file: 'testing.html',           title: 'Testing & Quality',          short: 'Testing',         icon: 'flask',      group: 'Development',  desc: 'Vitest setup, every test suite, fixtures and linting.' },
    { id: 'deployment',       file: 'deployment.html',        title: 'PWA & Deployment',           short: 'Deployment',      icon: 'cloud',      group: 'Development',  desc: 'Service worker, manifest, hosting targets and CI/CD.' },
    { id: 'roadmap',          file: 'roadmap.html',           title: 'Roadmap & Known Gaps',       short: 'Roadmap',         icon: 'map',        group: 'Development',  desc: 'Planned features, unimplemented items and future formats.' }
  ];

  var GITHUB_URL = 'https://github.com/xensenx/webxreader';
  var EDIT_BASE = GITHUB_URL + '/blob/Exp%2Fset-1/docs/';

  function currentPageId() {
    var name = location.pathname.split('/').pop() || 'index.html';
    if (name === '' || name === '/') return 'index';
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].file === name) return PAGES[i].id;
    }
    return 'index';
  }

  function icon(name) { return I[name] || ''; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- Theme ---------- */
  var THEME_KEY = 'webxreader-docs-theme';

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = I[t === 'dark' ? 'sun' : 'moon'];
  }

  (function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* no storage */ }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  })();

  /* ---------- Build the shell ---------- */
  function buildShell() {
    var body = document.body;
    var current = currentPageId();

    /* Topbar */
    var topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML =
      '<button class="icon-btn menu-btn" id="menu-toggle" aria-label="Open menu">' + I.menu + '</button>' +
      '<a class="topbar__brand" href="index.html">' +
        '<span class="logo-mark">WX</span>' +
        '<span>WebXReader <small>Documentation</small></span>' +
      '</a>' +
      '<div class="topbar__search">' +
        '<span class="search-icon">' + I.search + '</span>' +
        '<input class="search-input" id="search-input" type="search" placeholder="Search documentation…" autocomplete="off" spellcheck="false" aria-label="Search documentation">' +
        '<span class="search-kbd">/</span>' +
        '<div class="search-results" id="search-results" role="listbox"></div>' +
      '</div>' +
      '<div class="topbar__actions">' +
        '<a class="icon-btn btn-label" href="' + GITHUB_URL + '" target="_blank" rel="noopener">' + I.github + ' GitHub</a>' +
        '<button class="icon-btn" id="theme-toggle" aria-label="Toggle theme">' + I.moon + '</button>' +
      '</div>';
    body.prepend(topbar);

    /* Sidebar */
    var sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.setAttribute('aria-label', 'Documentation navigation');
    var groups = {};
    PAGES.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });

    var html = '';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="sidebar__group"><div class="sidebar__group-title">' + esc(g) + '</div>';
      groups[g].forEach(function (p) {
        var active = p.id === current;
        html += '<a class="sidebar__link' + (active ? ' active' : '') + '" href="' + p.file + '"' +
                (current === p.id ? ' aria-current="page"' : '') + '>' +
                '<span class="sb-icon">' + icon(p.icon) + '</span>' + esc(p.short) +
                (p.badge ? '<span class="sidebar__badge">' + esc(p.badge) + '</span>' : '') +
                '</a>';
      });
      html += '</div>';
    });
    sidebar.innerHTML = html;
    body.appendChild(sidebar);

    var overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    body.appendChild(overlay);

    /* Wrap article into shell + add TOC + pager + footer */
    var article = document.getElementById('content');
    var main = document.createElement('main');
    main.className = 'main';

    var wrap = document.createElement('div');
    wrap.className = 'content-wrap';
    article.classList.add('article');
    article.removeAttribute('id');
    article.id = 'article';
    wrap.appendChild(article);

    var toc = document.createElement('aside');
    toc.className = 'page-toc';
    toc.id = 'page-toc';
    wrap.appendChild(toc);

    main.appendChild(wrap);
    body.appendChild(main);

    /* Pager */
    var idx = PAGES.findIndex(function (p) { return p.id === current; });
    var pager = document.createElement('div');
    pager.className = 'pager';
    pager.innerHTML =
      (idx > 0
        ? '<a href="' + PAGES[idx - 1].file + '"><span class="dir">Previous</span><span class="title">' + esc(PAGES[idx - 1].title) + '</span></a>'
        : '<span style="flex:1"></span>') +
      (idx < PAGES.length - 1
        ? '<a class="next" href="' + PAGES[idx + 1].file + '"><span class="dir">Next</span><span class="title">' + esc(PAGES[idx + 1].title) + '</span></a>'
        : '<span style="flex:1"></span>');
    article.appendChild(pager);

    /* Edit link */
    var edit = document.createElement('div');
    edit.innerHTML = '<a class="edit-link" href="' + EDIT_BASE + (PAGES[idx] ? PAGES[idx].file : 'index.html') + '" target="_blank" rel="noopener">' + I.external + ' Edit this page on GitHub</a>';
    article.appendChild(edit.firstChild);

    /* Footer */
    var footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML =
      '<span>© ' + new Date().getFullYear() + ' WebXReader — local-first web novel reader</span>' +
      '<a href="' + GITHUB_URL + '" target="_blank" rel="noopener">GitHub repository</a>' +
      '<a href="https://webxreader.web.app/" target="_blank" rel="noopener">Live app</a>' +
      '<span>Docs built from the <code>Exp/set-1</code> branch</span>';
    article.appendChild(footer);

    /* Toast */
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.id = 'toast';
    body.appendChild(toast);
  }

  /* ---------- Page TOC from h2/h3 headings ---------- */
  function buildPageToc() {
    var aside = document.getElementById('page-toc');
    if (!aside) return;
    var heads = document.querySelectorAll('#article h2[id], h3[id]');
    if (!heads.length) { aside.style.display = 'none'; return; }

    var items = [];
    heads.forEach(function (h) { items.push({ tag: h.tagName, id: h.id, text: h.textContent }); });

    var html = '<div class="page-toc__title">On this page</div><ul>';
    items.forEach(function (it) {
      html += '<li class="' + (it.tag === 'H3' ? 'lvl3' : 'lvl2') + '"><a href="#' + it.id + '">' + esc(it.text) + '</a></li>';
    });
    html += '</ul>';
    aside.innerHTML = html;

    /* Scroll-spy */
    var links = aside.querySelectorAll('a');
    var map = {};
    items.forEach(function (it, i) { map[it.id] = links[i]; });

    var onScroll = function () {
      var pos = window.scrollY + window.innerHeight * 0.28;
      var currentId = items.length ? items[0].id : null;
      items.forEach(function (it) {
        var el = document.getElementById(it.id);
        if (el && el.offsetTop <= pos) currentId = it.id;
      });
      Object.keys(map).forEach(function (id) { map[id].classList.toggle('current', id === currentId); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Heading anchor links ---------- */
  function addHeadingAnchors() {
    document.querySelectorAll('#article h1[id], h2[id], h3[id], h4[id]').forEach(function (h) {
      var a = document.createElement('a');
      a.className = 'anchor-link';
      a.href = '#' + h.id;
      a.textContent = '#';
      a.setAttribute('aria-label', 'Link to this section');
      h.appendChild(a);
    });
  }

  /* ---------- Code highlighting ---------- */
  var KEYWORDS = /\b(await|async|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|set|satisfies|static|super|switch|this|throw|try|type|typeof|var|void|while|yield|true|false|null|undefined|SELECT|FROM|WHERE|LEFT|JOIN|ON|GROUP|BY|ORDER|AND|OR|NOT|AS|LIMIT)\b/g;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(code, lang) {
    var src = escapeHtml(code);

    /* Protect strings & comments first via tokenization */
    var tokens = [];
    function stash(re) {
      src = src.replace(re, function (m) {
        tokens.push(m);
        return '\u0000' + (tokens.length - 1) + '\u0000';
      });
    }

    if (lang === 'sql') {
      stash(/--[^\n]*/g);
      stash(/'(?:[^']|'')*'?/g);
    } else {
      stash(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g);          /* comments */
      stash(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g); /* strings */
    }

    /* numbers, keywords, common API-ish identifiers */
    src = src.replace(/\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
    src = src.replace(KEYWORDS, '<span class="tok-kw">$1</span>');

    /* restore strings/comments */
    src = src.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      var t = tokens[+i];
      var isComment = t.indexOf('//') === 0 || t.indexOf('/*') === 0;
      return '<span class="' + (isComment ? 'tok-com' : 'tok-str') + '">' + t + '</span>';
    });
    return src;
  }

  function enhanceCodeBlocks() {
    document.querySelectorAll('pre').forEach(function (pre) {
      if (pre.closest('.code-block')) return;
      var code = pre.querySelector('code');
      var raw = code ? code.textContent : pre.textContent;
      var lang = '';
      if (code) {
        var m = (pre.className + ' ' + code.className).match(/language-([\w-]+)/);
        lang = m ? m[1] : '';
        if (!lang) {
          if (/^\s*[{[]/.test(raw)) lang = 'json';
          else if (/npm |npx |git |node |pnpm/.test(raw)) lang = 'bash';
          else if (/CREATE TABLE|SELECT /i.test(raw)) lang = 'sql';
          else if (/=>|\bconst\b|\binterface\b|\basync\b/.test(raw)) lang = 'ts';
        }
      }
      var block = document.createElement('div');
      block.className = 'code-block';
      block.innerHTML =
        '<div class="code-block__bar"><span>' + esc(lang || 'code') + '</span>' +
        '<button class="code-block__copy" type="button">' + I.copy + ' Copy</button></div>';
      block.querySelector('.code-block__copy').addEventListener('click', function () {
        navigator.clipboard.writeText(raw).then(function () {
          var b = block.querySelector('.code-block__copy');
          b.innerHTML = I.check + ' Copied';
          setTimeout(function () { b.innerHTML = I.copy + ' Copy'; }, 1600);
        }).catch(function () {});
      });
      var parent = pre.parentNode;
      parent.insertBefore(block, pre);
      pre.remove();
      block.appendChild(pre);
      if (raw.length < 14000) code.innerHTML = highlight(raw, lang);
    });
  }

  /* ---------- Search ---------- */
  var SEARCH_INDEX = [];

  var PAGE_CONTENT_HINTS = {
    'index': 'local first privacy reader novel comic library pwa offline multiformat epub pdf cbz txt markdown html webxreader overview facts features',
    'getting-started': 'prerequisites node 22 npm install npm run dev build preview lint oxlint vitest firebase deploy cloudflare pages hash router guide local development 4173',
    'architecture': 'tech stack react 19 typescript vite 8 folder structure src main tsx app tsx hash router settings provider lazy engines css modules design tokens state management hooks bullet',
    'data-model': 'Book BookMetadata BookContent Chapter ReadingProgress Bookmark Annotation UserSettings BookSettings BackupData ReadingSession defaults theme light Georgia 18 1.7 maxContentWidth 720 importSizeWarningMB 50 ReadingStatus HighlightColor ComicReadingDirection',
    'formats': 'format registry options definitions extensions mime types capabilities epub pdf cbz txt markdown html parse metadata tableOfContents champions natural compare natural sort ComicInfo requiresOriginalFile reflowable fixed layout',
    'reader': 'ReaderView engine lazy scroll paginated vertical double sided epub reader pdf reader cbz reader zoom ctrl wheel pinch shortcuts h t b s f escape search toc bookmarks settings drawers fullscreen restore progress cfi page index resume',
    'library': 'LibraryView toolbar search filters sort custom drag reorder flip pointer capture book details cover editor tags rating archive favorite session storage BookCard BookList',
    'storage': 'indexeddb object stores books bookContent progress bookmarks annotations settings bookSettings covers schema indexes atomic transaction saveBookBundle deleteBook cascade exportBackup restore localStorage preferences legacy migration persistent storage quota estimate',
    'import-export': 'import-service importFile steps hash sha 256 dedupe duplicate options autoDetectChapters textEncoding backup-service downloadLibraryBackup restoreLibraryBackup downloadOriginalBook base64 chunk v1 v2 sanitize restore rollback atomic',
    'testing': 'vitest jsdom fake indexeddb setup mocks randomuuid digest fetch storybook tolerant running npm test watch suites coverage',
    'deployment': 'pwa service worker manifest cache shell v5 offline network first cache first firebase hosting cloudflare pages workflow star deployment docs.site deployment github pages prerender hash router 4173 vite preview',
    'roadmap': 'roadmap unimplemented features reading stats session tracker offline dictionary ambient audio keyboard navigation todo pending formats rtf cb7 mobi fb2 djvu xps cbr tts reading session wip future implementations details future'
  };

  /**
   * Searchable entries: page-level tokens from hints + section anchors.
   * Sections and per-page tokens are combined at query time via the DOM
   * where possible, plus static page hints defined above.
   */
  function buildSearchIndex() {
    SEARCH_INDEX = [];
    PAGES.forEach(function (p) {
      SEARCH_INDEX.push({ file: p.file, page: p.title, section: '', text: (p.title + ' ' + p.desc + ' ' + (PAGE_CONTENT_HINTS[p.id] || '')).toLowerCase() });
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', p.file, false); /* synchronous small fetches at load; acceptable for 12 static pages */
        xhr.send();
        if (xhr.status !== 200) return;
        var doc = new DOMParser().parseFromString(xhr.responseText, 'text/html');
        doc.querySelectorAll('h2[id], h3[id]').forEach(function (h) {
          var nextText = '';
          var node = h.nextElementSibling;
          var hops = 0;
          while (node && nextText.length < 220 && hops < 4) {
            if (node.tagName === 'H2' || node.tagName === 'H3') break;
            nextText += ' ' + node.textContent;
            node = node.nextElementSibling;
            hops++;
          }
          SEARCH_INDEX.push({ file: p.file + '#' + h.id, page: p.title, section: h.textContent, text: (h.textContent + ' ' + nextText).toLowerCase() });
        });
      } catch (e) { /* offline or blocked */ }
    });
  }

  function runSearch(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var terms = q.split(/\s+/).filter(Boolean);
    var out = [];
    SEARCH_INDEX.forEach(function (entry) {
      var score = 0;
      var ok = true;
      terms.forEach(function (t) {
        var at = entry.text.indexOf(t);
        if (at === -1) { ok = false; return; }
        score += (entry.text.startsWith(t) || entry.title.toLowerCase().indexOf(t) !== -1) ? 3 : 1;
        if (t.length > 3) score += 1;
      });
      if (ok) out.push({ entry: entry, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 14);
  }

  function wireSearch() {
    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    var activeIdx = -1;
    var currentResults = [];

    function open(r) {
      results.innerHTML = '';
      currentResults = r;
      activeIdx = -1;
      if (!r.length) {
        results.innerHTML = '<div class="search-empty">No matching results — try other keywords.</div>';
      } else {
        r.forEach(function (hit) {
          var a = document.createElement('a');
          a.className = 'search-result';
          a.href = hit.entry.file;
          var first = input.value.trim().toLowerCase().split(/\s+/)[0] || '';
          var at = Math.max(0, hit.entry.text.indexOf(first) - 40);
          var excerpt = hit.entry.text.slice(at, at + 210).replace(/\s+/g, ' ');
          a.innerHTML = '<div class="sr-page">' + esc(hit.entry.page) + (hit.entry.section ? ' · ' + esc(hit.entry.section) : '') + '</div>' +
                        '<div class="sr-title"></div><div class="sr-excerpt">' + esc(excerpt) + '…</div>';
          a.querySelector('.sr-title').textContent = hit.entry.section || hit.entry.title;
          results.appendChild(a);
        });
      }
      results.classList.add('open');
    }

    function close() { results.classList.remove('open'); }

    input.addEventListener('focus', function () { if (input.value) open(runSearch(input.value)); });

    input.addEventListener('input', function () {
      if (input.value.trim().length < 2) { close(); return; }
      open(runSearch(input.value));
    });

    input.addEventListener('keydown', function (e) {
      var links = results.querySelectorAll('a.search-result');
      if (e.key === 'Escape') { close(); input.blur(); return; }
      if (e.key === 'ArrowDown' && links.length) {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % links.length;
      } else if (e.key === 'ArrowUp' && links.length) {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + links.length) % links.length;
      } else if (e.key === 'Enter') {
        var target = activeIdx >= 0 && links[activeIdx] ? links[activeIdx] : links[0];
        if (target) { target.click(); close(); return; }
      } else return;
      links.forEach(function (l) { l.classList.remove('active'); });
      if (activeIdx >= 0 && links[activeIdx]) links[activeIdx].classList.add('active');
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.topbar__search')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        var tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    });
  }

  /* build index lazily (first search interaction) */
  var indexBuilt = false;
  function ensureSearchIndex() {
    if (indexBuilt) return;
    indexBuilt = true;
    buildSearchIndex();
  }

  /* ---------- Mobile sidebar + misc wiring ---------- */
  function wireMisc() {
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      applyTheme(next);
    });

    document.getElementById('menu-toggle').addEventListener('click', function () {
      document.body.classList.toggle('sidebar-open');
    });
    document.querySelector('.sidebar-overlay').addEventListener('click', function () {
      document.body.classList.remove('sidebar-open');
    });

    /* close mobile sidebar when navigating */
    document.querySelectorAll('.sidebar a').forEach(function (a) {
      a.addEventListener('click', function () { document.body.classList.remove('sidebar-open'); });
    });
  }

  /* ---------- *icon-name* placeholders → inline SVG ---------- */
  function resolveIconTokens(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) {
      if (/\*icon-[a-zA-Z]+\*/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    }
    nodes.forEach(function (n) {
      var parent = n.parentNode;
      var frag = document.createDocumentFragment();
      var parts = n.nodeValue.split(/(\*icon-[a-zA-Z]+\*)/g);
      parts.forEach(function (p) {
        var m = p.match(/^\*icon-([a-zA-Z]+)\*$/);
        if (m && I[m[1]]) {
          var span = document.createElement('span');
          span.style.cssText = 'display:inline-flex;vertical-align:middle;';
          span.innerHTML = I[m[1]];
          frag.appendChild(span);
        } else if (p) {
          frag.appendChild(document.createTextNode(p));
        }
      });
      parent.replaceChild(frag, n);
    });
  }

  /* ---------- Boot ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    buildShell();
    resolveIconTokens(document.body);
    enhanceCodeBlocks();
    addHeadingAnchors();
    buildPageToc();
    wireSearch();
    wireMisc();

    /* prebuild search index in idle time */
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(ensureSearchIndex, { timeout: 2000 });
    } else {
      setTimeout(ensureSearchIndex, 350);
    }

    /* focus search via / */
    var searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.id = 'search-input'; /* stable */
  });
})();
