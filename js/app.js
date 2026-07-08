/* ════════════════════════════════════════════════════════════
   रसोई की विरासत — app logic
   Builds the book (cover → dedication → index → recipes → end),
   paginates content by real measurement, drives the page-flip,
   and handles text / paste / voice / file input with photos.
   ════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

const BASE_W = 560;                 // design width of one page, px
const PAGE_RATIO = 1.35;            // height / width
const MAX_PHOTOS = 6;

const PROVERBS = [
  ['जैसा अन्न, वैसा मन', 'As the food, so the mind.'],
  ['अतिथि देवो भव', 'The guest is God.'],
  ['माँ के हाथ का खाना ही असली स्वाद है', 'The truest taste is from a mother’s hands.'],
  ['रसोई घर की आत्मा है', 'The kitchen is the soul of the home.'],
];

const DEFAULT_DEDICATION =
  'For the hands that rolled hot rotis long past midnight,\n' +
  'for the kitchens of Uttar Pradesh that raised us,\n' +
  'and for every meal that quietly said — you are loved.';

const state = {
  recipes: [],
  settings: { family: '', dedication: DEFAULT_DEDICATION },
  muted: false,
};

let pageFlip = null;
let PW = BASE_W, PH = Math.round(BASE_W * PAGE_RATIO), FS = 16;
let recipeStart = new Map();   // recipe id -> page index
let totalPages = 0;

/* PageFlip's disableFlipByClick guard also blocks programmatic flips whose
   synthetic start point misses a page corner (flipPrev in portrait mode
   never hits one). Lift the flag around every programmatic flip. */
function animFlip(fn) {
  if (!pageFlip) return;
  const settings = pageFlip.getSettings ? pageFlip.getSettings() : null;
  const saved = settings ? settings.disableFlipByClick : undefined;
  if (settings) settings.disableFlipByClick = false;
  try { fn(); } finally { if (settings) settings.disableFlipByClick = saved; }
}
const goPrev = () => animFlip(() => pageFlip.flipPrev());
const goNext = () => animFlip(() => pageFlip.flipNext());
const goTo = (i) => animFlip(() => pageFlip.flip(i));

/* ───────────────────────── helpers ───────────────────────── */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function svgUse(ref, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', ref);
  s.appendChild(u);
  return s;
}
function ornamentRule(cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 200 24');
  s.setAttribute('class', cls || 'r-ornament');
  s.innerHTML =
    '<g fill="none" stroke="currentColor" stroke-width="1.6">' +
    '<line x1="0" y1="12" x2="78" y2="12"/><line x1="122" y1="12" x2="200" y2="12"/>' +
    '<path d="M100 3 L109 12 L100 21 L91 12 Z"/><circle cx="100" cy="12" r="2.4" fill="currentColor"/>' +
    '<circle cx="82" cy="12" r="1.8" fill="currentColor"/><circle cx="118" cy="12" r="1.8" fill="currentColor"/></g>';
  return s;
}
function toast(msg, isErr) {
  const t = el('div', 'toast' + (isErr ? ' err' : ''), msg);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}
function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function escapeless(s) { return (s || '').trim(); }

/* ─────────────────────── page factory ────────────────────── */

function makePage(cls) {
  const page = el('div', 'page' + (cls ? ' ' + cls : ''));
  const inner = el('div', 'page-inner');
  inner.style.width = PW + 'px';
  inner.style.height = PH + 'px';
  inner.style.fontSize = FS + 'px';
  page.appendChild(inner);
  return { page, inner };
}

function makeContentPage(cls, runnerText) {
  const { page, inner } = makePage(cls);
  inner.appendChild(svgUse('#boota', 'corner-boota tl'));
  inner.appendChild(svgUse('#boota', 'corner-boota tr'));
  inner.appendChild(svgUse('#boota', 'corner-boota bl'));
  inner.appendChild(svgUse('#boota', 'corner-boota br'));
  if (cls && cls.indexOf('page-body') !== -1) inner.appendChild(svgUse('#degchi', 'watermark'));
  if (runnerText) inner.appendChild(el('div', 'runner', runnerText));
  const flow = el('div', 'flow');
  inner.appendChild(flow);
  inner.appendChild(el('div', 'folio', ''));
  return { page, inner, flow };
}

/* Flow blocks into as many pages as needed (measured for real). */
function flowBlocks(blocks, newPage) {
  const measurer = $('#measurer');
  const pages = [];
  let cur = newPage(0);
  measurer.appendChild(cur.page);
  const overflows = () => cur.flow.scrollHeight > cur.flow.clientHeight + 1;

  for (const b of blocks) {
    cur.flow.appendChild(b);
    if (overflows()) {
      cur.flow.removeChild(b);
      if (cur.flow.children.length === 0) {         // block taller than a page: place clipped
        cur.flow.appendChild(b);
        pages.push(cur);
        cur = newPage(pages.length); measurer.appendChild(cur.page);
        continue;
      }
      pages.push(cur);
      cur = newPage(pages.length); measurer.appendChild(cur.page);
      cur.flow.appendChild(b);
      if (overflows()) {                             // oversize even alone
        pages.push(cur);
        cur = newPage(pages.length); measurer.appendChild(cur.page);
      }
    }
  }
  if (cur.flow.children.length || pages.length === 0) pages.push(cur);
  return pages;
}

function splitLong(text, maxLen) {
  const paras = String(text || '').split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of paras) {
    if (p.length <= maxLen) { out.push(p); continue; }
    const sentences = p.match(/[^.!?।]+[.!?।]*\s*/g) || [p];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > maxLen && buf) { out.push(buf.trim()); buf = ''; }
      buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/* ─────────────────── special page builders ───────────────── */

function buildCover() {
  const { page, inner } = makePage('page-cover');
  page.setAttribute('data-density', 'hard');
  inner.appendChild(svgUse('#genda', 'cover-garland top'));
  inner.appendChild(svgUse('#genda', 'cover-garland bot'));
  const med = el('div', 'cover-medallion');
  med.appendChild(svgUse('#chai-samosa'));
  inner.appendChild(med);
  inner.appendChild(el('div', 'cover-hindi', 'रसोई की विरासत'));
  inner.appendChild(el('div', 'cover-title', 'The Family Recipe Book'));
  const fam = state.settings.family && state.settings.family.trim();
  inner.appendChild(el('div', 'cover-family', fam ? `of the ${fam} family` : 'of our family'));
  inner.appendChild(ornamentRule('cover-rule'));
  inner.appendChild(el('div', 'cover-tag', 'swad · virasat · parivaar'));
  return page;
}

function buildBackCover() {
  const { page, inner } = makePage('page-cover');
  page.setAttribute('data-density', 'hard');
  inner.appendChild(svgUse('#chai-samosa', 'cover-back-motif'));
  inner.appendChild(el('div', 'cover-tag', 'made with love, kept forever'));
  return page;
}

function buildDedication() {
  const { page, flow } = makeContentPage('page-dedication');
  flow.appendChild(svgUse('#genda', 'ded-garland'));
  flow.appendChild(el('div', 'ded-hindi', '॥ अन्नपूर्णा को प्रणाम ॥'));
  const fam = state.settings.family && state.settings.family.trim();
  flow.appendChild(el('div', 'ded-family', fam ? `The ${fam} Family` : 'Our Family'));
  flow.appendChild(el('div', 'ded-text', state.settings.dedication || DEFAULT_DEDICATION));
  flow.appendChild(ornamentRule('ded-ornament'));
  const hint = el('div', 'ded-edit-hint', '— change this dedication with the ✒ button above —');
  flow.appendChild(hint);
  return page;
}

function buildTocPages() {
  const entries = state.recipes.map((r) => {
    const row = el('div', 'toc-row');
    const b = el('button', 'toc-entry');
    b.type = 'button';
    row.dataset.rid = r.id;
    const name = el('span', 'toc-name', r.title);
    name.appendChild(el('span', 'toc-cat', (r.category || '').split('·')[0].trim() + (r.origin ? ' — ' + r.origin : '')));
    b.appendChild(name);
    b.appendChild(el('span', 'toc-dots'));
    b.appendChild(el('span', 'toc-num', '000'));
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = recipeStart.get(r.id);
      if (idx !== undefined) goTo(idx);
    });
    const edit = el('button', 'toc-edit', '✎');
    edit.type = 'button';
    edit.title = 'Edit “' + r.title + '”';
    edit.addEventListener('click', (ev) => { ev.stopPropagation(); openRecipeModal(r.id); });
    row.appendChild(b);
    row.appendChild(edit);
    return row;
  });

  const newTocPage = (i) => {
    const p = makeContentPage('page-toc');
    if (i === 0) {
      p.flow.appendChild(svgUse('#degchi', 'toc-motif'));
      p.flow.appendChild(el('div', 'toc-title', 'ANUKRAMANIKA'));
      p.flow.appendChild(el('div', 'toc-sub', 'अनुक्रमणिका · the recipes within'));
    } else {
      p.flow.appendChild(el('div', 'toc-sub', 'अनुक्रमणिका · continued'));
    }
    return p;
  };

  if (!entries.length) {
    const p = newTocPage(0);
    const empty = el('div', 'toc-empty',
      'The pages of this book are waiting.\nPress “✚ Add Recipe” and bind your first family recipe —\nwritten, spoken, or from a file.');
    empty.style.whiteSpace = 'pre-line';
    p.flow.appendChild(empty);
    return { pages: [p], entries: [] };
  }
  return { pages: flowBlocks(entries, newTocPage), entries };
}

const FILLER_MOTIFS = ['#diya', '#chai-samosa', '#degchi', '#paisley'];
function buildFiller(i) {
  const { page, flow } = makeContentPage('page-filler');
  const [hi, en] = PROVERBS[i % PROVERBS.length];
  flow.appendChild(svgUse(FILLER_MOTIFS[i % FILLER_MOTIFS.length], 'filler-motif'));
  flow.appendChild(el('div', 'filler-hindi', hi));
  flow.appendChild(el('div', 'filler-en', en));
  return page;
}

function buildClosing() {
  const { page, flow } = makeContentPage('page-filler');
  flow.appendChild(svgUse('#diya', 'filler-motif'));
  flow.appendChild(el('div', 'filler-hindi', '॥ समाप्त ॥'));
  flow.appendChild(el('div', 'filler-en', 'The story continues in your kitchen.'));
  return page;
}

/* ───────────────── recipe page construction ──────────────── */

function makeArchFig(src, alt) {
  const arch = el('div', 'arch');
  const img = el('img');
  img.src = src; img.alt = alt || 'family photograph'; img.draggable = false;
  arch.appendChild(img);
  return arch;
}

function makeAudioChip(audio) {
  const chip = el('div', 'audio-chip fb');
  const btn = el('button', '', '▶');
  btn.type = 'button';
  const label = el('span', 'ac-label', 'a voice from the kitchen — listen');
  let player = null;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!player) {
      player = new Audio(audio.data);
      player.addEventListener('ended', () => { btn.textContent = '▶'; });
    }
    if (player.paused) { player.play(); btn.textContent = '❚❚'; }
    else { player.pause(); btn.textContent = '▶'; }
  });
  chip.appendChild(btn); chip.appendChild(label);
  return chip;
}

function buildRecipePages(recipe) {
  const pages = [];

  /* — story page(s) — */
  const storyBlocks = [];
  const head = el('div', 'fb');
  head.appendChild(el('div', 'r-chapter', (recipe.category || 'Recipe').split('·')[0].trim()));
  head.appendChild(el('div', 'r-title', recipe.title));
  if (recipe.origin) head.appendChild(el('div', 'r-origin', 'from the kitchen of ' + recipe.origin));
  head.appendChild(ornamentRule());
  storyBlocks.push(head);
  if (recipe.audio) storyBlocks.push(makeAudioChip(recipe.audio));
  const paras = splitLong(recipe.story, 640);
  paras.forEach((p, i) => {
    const d = el('div', 'r-story fb' + (i > 0 ? ' cont' : ''), p);
    storyBlocks.push(d);
  });

  const storyPages = flowBlocks(storyBlocks, (i) =>
    makeContentPage('page-story', i > 0 ? recipe.title + ' · the story, continued' : null));

  // pin edit/delete tools to the first story page
  const tools = el('div', 'r-tools');
  const bEdit = el('button', '', '✎ edit');
  const bDel = el('button', '', '🗑');
  bEdit.type = bDel.type = 'button';
  bEdit.title = 'Edit this recipe'; bDel.title = 'Remove this recipe';
  bEdit.addEventListener('click', (ev) => { ev.stopPropagation(); openRecipeModal(recipe.id); });
  bDel.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!confirm(`Remove “${recipe.title}” from the book?`)) return;
    await RB_DB.deleteRecipe(recipe.id);
    state.recipes = state.recipes.filter(r => r.id !== recipe.id);
    toast('Recipe removed from the book.');
    rebuildBook();
  });
  tools.appendChild(bEdit); tools.appendChild(bDel);
  storyPages[0].inner.appendChild(tools);

  // hero photo in remaining space of the last story page
  const photos = recipe.photos || [];
  let heroUsed = false;
  const lastStory = storyPages[storyPages.length - 1];
  if (photos.length) {
    const kids = Array.from(lastStory.flow.children);
    const last = kids[kids.length - 1];
    const usedBottom = last ? last.offsetTop + last.offsetHeight : 0;
    const remaining = lastStory.flow.clientHeight - usedBottom;
    if (remaining > FS * 10) {
      const fig = el('div', 'hero-fig');
      const h = remaining - FS * 0.9;
      const arch = makeArchFig(photos[0], recipe.title);
      arch.style.height = h + 'px';
      arch.style.width = Math.min(PW * 0.62, h * 0.82) + 'px';
      fig.appendChild(arch);
      lastStory.flow.appendChild(fig);
      heroUsed = true;
    }
  }
  pages.push(...storyPages);

  /* — recipe body page(s) — */
  const bodyBlocks = [];
  const chips = el('div', 'chips fb');
  if (recipe.serves) chips.appendChild(el('span', 'chip', /^(makes|serves|for)\b/i.test(recipe.serves) ? recipe.serves : 'serves ' + recipe.serves));
  if (recipe.time) chips.appendChild(el('span', 'chip', recipe.time));
  chips.appendChild(el('span', 'chip', (recipe.category || '').split('·')[0].trim() || 'recipe'));
  bodyBlocks.push(chips);

  if ((recipe.ingredients || []).length) {
    const h = el('div', 'sec-head fb');
    h.appendChild(document.createTextNode('Ingredients '));
    h.appendChild(el('span', 'sh-hindi', 'सामग्री'));
    bodyBlocks.push(h);
    recipe.ingredients.forEach(ing => {
      const it = el('div', 'ing-item fb', ing);
      if (ing.length > 42) it.classList.add('wide');
      bodyBlocks.push(it);
    });
  }
  if ((recipe.steps || []).length) {
    const h = el('div', 'sec-head fb');
    h.appendChild(document.createTextNode('Method '));
    h.appendChild(el('span', 'sh-hindi', 'विधि'));
    bodyBlocks.push(h);
    recipe.steps.forEach((s, i) => {
      const st = el('div', 'step fb');
      st.appendChild(el('span', 'step-num', String(i + 1)));
      st.appendChild(document.createTextNode(s));
      bodyBlocks.push(st);
    });
  }
  const bodyPages = flowBlocks(bodyBlocks, (i) =>
    makeContentPage('page-body', i === 0 ? recipe.title : recipe.title + ' · continued'));
  pages.push(...bodyPages);

  /* — album page(s) for the remaining photos — */
  const albumPhotos = heroUsed ? photos.slice(1) : photos.slice(0);
  for (let i = 0; i < albumPhotos.length; i += 4) {
    const chunk = albumPhotos.slice(i, i + 4);
    const p = makeContentPage('page-album', recipe.title + ' · yaadein');
    const grid = el('div', 'album-grid');
    chunk.forEach(src => grid.appendChild(makeArchFig(src, recipe.title)));
    p.flow.appendChild(grid);
    p.flow.appendChild(el('div', 'album-note', 'photographs from our table · हमारी यादें'));
    $('#measurer').appendChild(p.page);
    pages.push(p);
  }

  return pages.map(p => p.page);
}

/* ────────────────────── book assembly ────────────────────── */

let IS_PORTRAIT = false;
function computePageSize() {
  const stage = $('#stage');
  const availW = Math.max(300, stage.clientWidth - 130);
  const availH = Math.max(320, stage.clientHeight - 46);
  IS_PORTRAIT = availW < 700;
  let w;
  if (!IS_PORTRAIT) w = Math.min(620, Math.floor(availW / 2), Math.floor(availH / PAGE_RATIO));
  else w = Math.min(560, availW - 10, Math.floor(availH / PAGE_RATIO));
  PW = Math.max(280, w);
  PH = Math.round(PW * PAGE_RATIO);
  FS = Math.max(10.5, Math.min(18, (PW / BASE_W) * 16));
}

let fillerCount = 0;
function assemblePages() {
  const measurer = $('#measurer');
  measurer.innerHTML = '';
  fillerCount = 0;
  recipeStart = new Map();

  const front = [buildCover(), buildDedication()];
  const toc = buildTocPages();
  toc.pages.forEach(p => front.push(p.page));

  const pages = [...front];
  if (pages.length % 2 === 0) pages.push(buildFiller(fillerCount++)); // recipes start on a left page

  for (const r of state.recipes) {
    recipeStart.set(r.id, pages.length);
    const rp = buildRecipePages(r);
    pages.push(...rp);
    if (rp.length % 2 !== 0) pages.push(buildFiller(fillerCount++));
  }

  pages.push(buildClosing());
  if (pages.length % 2 === 0) pages.push(buildFiller(fillerCount++));
  pages.push(buildBackCover());

  // folios, parity classes, TOC numbers
  pages.forEach((p, i) => {
    if (i > 0 && i < pages.length - 1) p.classList.add(i % 2 === 1 ? '--left' : '--right');
    const folio = p.querySelector('.folio');
    if (folio) folio.textContent = '❧ ' + i + ' ❧';
  });
  toc.entries.forEach(row => {
    const idx = recipeStart.get(row.dataset.rid);
    row.querySelector('.toc-num').textContent = idx !== undefined ? idx : '·';
  });

  return pages;
}

function rebuildBook(targetIndex) {
  computePageSize();
  const keep = targetIndex !== undefined ? targetIndex
    : (pageFlip ? pageFlip.getCurrentPageIndex() : 0);

  const pages = assemblePages();
  totalPages = pages.length;

  // destroy() leaves the old container in an unusable state — always start
  // from a fresh #book element, sized explicitly so PageFlip picks the
  // spread (landscape) orientation on wide screens.
  if (pageFlip) { try { pageFlip.destroy(); } catch (e) { /* noop */ } pageFlip = null; }
  const oldBook = document.getElementById('book');
  if (oldBook) oldBook.remove();
  const bookEl = document.createElement('div');
  bookEl.id = 'book';
  // PageFlip sets #book to width:100% — the wrap must carry the real size,
  // otherwise (as a shrink-to-fit flex item) it collapses to one page wide
  // and PageFlip falls back to portrait.
  const wrap = $('#book-wrap');
  wrap.style.width = (IS_PORTRAIT ? PW : PW * 2) + 'px';
  wrap.style.height = PH + 'px';
  wrap.appendChild(bookEl);
  const frag = document.createDocumentFragment();
  pages.forEach(p => frag.appendChild(p));
  bookEl.appendChild(frag);
  $('#measurer').innerHTML = '';

  pageFlip = new St.PageFlip(bookEl, {
    width: PW,
    height: PH,
    size: 'fixed',
    showCover: true,
    usePortrait: true,
    flippingTime: 1100,
    maxShadowOpacity: 0.65,
    drawShadow: true,
    mobileScrollSupport: false,
    showPageCorners: true,
    disableFlipByClick: true,
  });
  pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
  pageFlip.on('flip', () => { updateIndicator(); });
  pageFlip.on('changeState', (e) => {
    if (e.data === 'flipping' || e.data === 'user_fold') playFlip();
  });

  const idx = Math.min(keep, totalPages - 1);
  if (idx > 0) pageFlip.turnToPage(idx);
  updateIndicator();
}

function updateIndicator() {
  if (!pageFlip) return;
  const i = pageFlip.getCurrentPageIndex();
  const label = i <= 0 ? '❦ the cover'
    : i >= totalPages - 1 ? '❦ the end'
    : `page ${i} of ${totalPages - 2}`;
  $('#page-indicator').textContent = label;
  $('#book-wrap').classList.toggle('open', i > 0 && i < totalPages - 1);
}

/* ─────────────────── page-turn sound ─────────────────────── */

let audioCtx = null;
function playFlip() {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const ctx = audioCtx, dur = 0.5;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      const attack = t < 0.1 ? t / 0.1 : 1;
      d[i] = (Math.random() * 2 - 1) * attack * Math.pow(1 - t, 2.2);
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1500, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + dur);
    const g = ctx.createGain(); g.gain.value = 0.28;
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start();
  } catch (e) { /* sound is a garnish, never block on it */ }
}

/* ─────────────────── recipe text parsing ─────────────────── */

function parseRecipeText(text) {
  const out = { title: '', story: '', serves: '', time: '', ingredients: [], steps: [] };
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let section = null;
  const story = [], ings = [], steps = [], loose = [];

  const secOf = (l) => {
    const s = l.replace(/^[#*\s]+|[:：\s]+$/g, '').toLowerCase();
    if (/^(ingredients?|samagri|सामग्री)$/.test(s)) return 'ing';
    if (/^(method|directions?|instructions?|steps?|preparation|recipe|vidhi|विधि)$/.test(s)) return 'steps';
    if (/^(story|about|memory|memories|why( it'?s special)?|कहानी)$/.test(s)) return 'story';
    return null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const sec = secOf(line);
    if (sec) { section = sec; continue; }
    let m;
    if ((m = line.match(/^serves?\s*[:\-–]?\s*(.+)/i)) && !out.serves) { out.serves = m[1].trim(); continue; }
    if ((m = line.match(/^(?:total\s+)?(?:cook(?:ing)?|prep)?\s*time\s*[:\-–]?\s*(.+)/i)) && !out.time) { out.time = m[1].trim(); continue; }
    if (!out.title && !section) { out.title = line.replace(/^#+\s*/, ''); continue; }
    const clean = line.replace(/^(?:step\s*)?\d+[.)]\s*/i, '').replace(/^[-*•●▪]\s*/, '');
    if (section === 'ing') ings.push(clean);
    else if (section === 'steps') steps.push(clean);
    else if (section === 'story') story.push(line);
    else loose.push(clean);
  }

  if (!ings.length && !steps.length && loose.length) {
    const qty = /^\d|\b(cups?|tbsps?|tsps?|tablespoons?|teaspoons?|kg|g\b|grams?|ml|litres?|liters?|pinch|katori|chammach|handful)\b/i;
    for (const l of loose) (qty.test(l) && l.length < 70 ? ings : steps).push(l);
  } else if (loose.length) {
    story.push(...loose);
  }
  out.story = story.join('\n\n');
  out.ingredients = ings;
  out.steps = steps;
  return out;
}

function applyParsed(parsed, mode) {
  const put = (id, val) => {
    const f = $(id);
    if (!val) return;
    if (!f.value.trim() || mode === 'replace') f.value = val;
    else f.value = f.value.trimEnd() + '\n' + val;
  };
  if (parsed.title && !$('#f-title').value.trim()) $('#f-title').value = parsed.title;
  put('#f-story', parsed.story);
  put('#f-ingredients', (parsed.ingredients || []).join('\n'));
  put('#f-steps', (parsed.steps || []).join('\n'));
  if (parsed.serves && !$('#f-serves').value.trim()) $('#f-serves').value = parsed.serves;
  if (parsed.time && !$('#f-time').value.trim()) $('#f-time').value = parsed.time;
}

/* ─────────────────────── images ──────────────────────────── */

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1400;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* ──────────────────── modal: add / edit ──────────────────── */

let editingId = null;
let modalPhotos = [];
let modalAudio = null;

function renderPhotoStrip() {
  const strip = $('#photo-strip');
  strip.innerHTML = '';
  modalPhotos.forEach((src, i) => {
    const t = el('div', 'photo-thumb');
    t.appendChild(makeArchFig(src, 'photo ' + (i + 1)));
    const x = el('button', 'ph-x', '✕');
    x.type = 'button'; x.title = 'remove photo';
    x.addEventListener('click', () => { modalPhotos.splice(i, 1); renderPhotoStrip(); });
    t.appendChild(x);
    strip.appendChild(t);
  });
  $('#photo-count').textContent = `(${modalPhotos.length} / ${MAX_PHOTOS})`;
}

function renderAudioBlock() {
  const blk = $('#audio-block');
  if (modalAudio) {
    blk.hidden = false;
    $('#audio-preview').src = modalAudio.data;
  } else {
    blk.hidden = true;
    $('#audio-preview').removeAttribute('src');
  }
}

async function addPhotoFiles(files) {
  for (const f of files) {
    if (modalPhotos.length >= MAX_PHOTOS) { toast(`A page holds only ${MAX_PHOTOS} photographs.`, true); break; }
    try { modalPhotos.push(await compressImage(f)); }
    catch (e) { toast(`Couldn't read image “${f.name}”.`, true); }
  }
  renderPhotoStrip();
}

function openRecipeModal(id) {
  editingId = id || null;
  const r = id ? state.recipes.find(x => x.id === id) : null;
  $('#recipe-modal-title').textContent = r ? 'Edit “' + r.title + '”' : 'Add a recipe to the book';
  $('#f-title').value = r ? r.title : '';
  $('#f-origin').value = r ? (r.origin || '') : '';
  $('#f-category').value = r ? r.category : $('#f-category').options[0].value;
  $('#f-serves').value = r ? (r.serves || '') : '';
  $('#f-time').value = r ? (r.time || '') : '';
  $('#f-story').value = r ? (r.story || '') : '';
  $('#f-ingredients').value = r ? (r.ingredients || []).join('\n') : '';
  $('#f-steps').value = r ? (r.steps || []).join('\n') : '';
  modalPhotos = r ? [...(r.photos || [])] : [];
  modalAudio = r ? (r.audio || null) : null;
  $('#paste-box').value = '';
  $('#voice-transcript').value = '';
  $('#recipe-delete').hidden = !r;
  renderPhotoStrip(); renderAudioBlock();
  switchTab('write');
  $('#recipe-modal').hidden = false;
  $('#f-title').focus();
}

function closeRecipeModal() {
  stopVoice(true);
  $('#recipe-modal').hidden = true;
}

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}

async function saveRecipeFromForm(ev) {
  ev.preventDefault();
  const title = escapeless($('#f-title').value);
  if (!title) { toast('Every recipe needs a name.', true); $('#f-title').focus(); return; }
  const lines = (v) => v.split('\n').map(s => s.trim()).filter(Boolean);
  const existing = editingId ? state.recipes.find(x => x.id === editingId) : null;
  const recipe = {
    id: editingId || uid(),
    title,
    origin: escapeless($('#f-origin').value),
    category: $('#f-category').value,
    serves: escapeless($('#f-serves').value),
    time: escapeless($('#f-time').value),
    story: $('#f-story').value.trim(),
    ingredients: lines($('#f-ingredients').value),
    steps: lines($('#f-steps').value),
    photos: modalPhotos.slice(0, MAX_PHOTOS),
    audio: modalAudio,
    createdAt: existing ? existing.createdAt : Date.now(),
    order: existing ? (existing.order ?? existing.createdAt) : Date.now(),
  };
  try {
    await RB_DB.saveRecipe(recipe);
  } catch (e) {
    toast('Could not save — storage unavailable.', true);
    return;
  }
  if (existing) Object.assign(existing, recipe);
  else state.recipes.push(recipe);
  state.recipes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  closeRecipeModal();
  toast(existing ? 'Recipe updated.' : `“${title}” has been bound into the book.`);
  rebuildBook();
  const idx = recipeStart.get(recipe.id);
  if (idx !== undefined) setTimeout(() => goTo(idx), 150);
}

/* ───────────────────────── voice ─────────────────────────── */

let recog = null, mediaRecorder = null, recChunks = [], recStream = null, recording = false;
let recogFinal = '';

function voiceStatus(msg) { $('#voice-status').textContent = msg || ''; }

async function startVoice() {
  recChunks = []; recogFinal = '';
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('Microphone permission was refused.', true);
    return;
  }
  try {
    const mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : '';
    mediaRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      if ($('#voice-keep').checked && recChunks.length) {
        const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        modalAudio = { data: await blobToDataURL(blob), type: blob.type };
        renderAudioBlock();
        toast('Voice memory attached to this recipe.');
      }
    };
    mediaRecorder.start();
  } catch (e) {
    mediaRecorder = null;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recog = new SR();
    recog.lang = $('#voice-lang').value;
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) recogFinal += t + ' ';
        else interim += t;
      }
      $('#voice-transcript').value = (recogFinal + interim).trim();
    };
    recog.onerror = (e) => { if (e.error !== 'aborted') voiceStatus('transcription: ' + e.error); };
    recog.onend = () => { if (recording) { try { recog.start(); } catch (_) {} } };
    try { recog.start(); } catch (_) {}
    voiceStatus('Listening… speak the recipe, or hold the phone near the storyteller.');
  } else {
    voiceStatus('Live transcription is not supported in this browser — recording audio only.');
  }

  recording = true;
  const b = $('#voice-btn');
  b.textContent = '■ Stop recording';
  b.classList.add('recording');
}

function stopVoice(silent) {
  if (!recording && !recStream) return;
  recording = false;
  if (recog) { try { recog.stop(); } catch (_) {} recog = null; }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch (_) {} }
  if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
  const b = $('#voice-btn');
  b.textContent = '● Start recording';
  b.classList.remove('recording');
  if (!silent) voiceStatus('Recording finished.');
}

/* ─────────────────────── file intake ─────────────────────── */

async function routeFiles(files) {
  const imgs = [];
  for (const f of files) {
    if (f.type.startsWith('image/')) { imgs.push(f); continue; }
    if (f.type.startsWith('audio/')) {
      modalAudio = { data: await blobToDataURL(f), type: f.type };
      renderAudioBlock();
      toast('Audio attached as a voice memory.');
      continue;
    }
    if (f.type.startsWith('text/') || /\.(txt|md|markdown)$/i.test(f.name)) {
      const text = await f.text();
      applyParsed(parseRecipeText(text));
      switchTab('write');
      toast(`Read “${f.name}” into the recipe below — please look it over.`);
      continue;
    }
    toast(`“${f.name}” — use .txt/.md for recipes, or audio & image files.`, true);
  }
  if (imgs.length) await addPhotoFiles(imgs);
}

/* ────────────────── seed recipes (first run) ─────────────── */

function seedPhoto(c1, c2, big, small) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 1100;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1100);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  x.fillStyle = g; x.fillRect(0, 0, 900, 1100);
  x.strokeStyle = 'rgba(231,205,133,.5)'; x.lineWidth = 3;
  x.beginPath();                                    // arch line-drawing
  x.moveTo(140, 950); x.lineTo(140, 460);
  x.bezierCurveTo(140, 260, 300, 190, 420, 175);
  x.quadraticCurveTo(440, 130, 450, 90);
  x.quadraticCurveTo(460, 130, 480, 175);
  x.bezierCurveTo(600, 190, 760, 260, 760, 460);
  x.lineTo(760, 950); x.stroke();
  x.fillStyle = 'rgba(231,205,133,.28)';
  for (let i = 0; i < 60; i++) {
    x.beginPath();
    x.arc((i * 137) % 900, (i * 211) % 1100, 3, 0, 7);
    x.fill();
  }
  x.fillStyle = '#f2e2b8'; x.textAlign = 'center';
  x.font = '64px serif';
  x.fillText(big, 450, 560);
  x.font = 'italic 34px serif';
  x.fillText(small, 450, 640);
  x.font = 'italic 26px serif';
  x.fillStyle = 'rgba(242,226,184,.75)';
  x.fillText('— add your own photograph here —', 450, 1020);
  return c.toDataURL('image/jpeg', 0.8);
}

function seedRecipes() {
  const now = Date.now();
  return [
    {
      id: uid(), createdAt: now, order: now, sample: true,
      title: 'Mathura ke Pede',
      origin: 'Nani · Mathura',
      category: 'Mithai · मिठाई',
      serves: 'makes ~20', time: '40 min',
      story:
        'Every winter, the train from Mathura brought two things: Nani, and a steel dabba of pede wrapped in an old sari border. ' +
        'She would press one into each of our palms before we had even touched her feet, laughing that blessings work faster on a sweet tongue. ' +
        'This is her recipe, measured the way she measured everything — by eye, by hand, and by heart. We write it down so her hands are never forgotten.\n' +
        'This is a sample page — press ✎ to make it your own, or 🗑 to remove it.',
      ingredients: ['500 g khoya (mawa)', '250 g boora or tagar', '2 tbsp desi ghee', '8 green cardamoms, crushed', 'a few strands of saffron', 'pista slivers, to dress'],
      steps: [
        'Crumble the khoya and knead it smooth with your palm.',
        'Roast it in ghee on the lowest flame till it smells of warm milk and turns fawn-coloured.',
        'Cool it a little, then work in the boora, cardamom and saffron.',
        'Roll into small rounds, press a thumbprint on top and dress with pista.',
        'Rest them for an hour — they firm up as they cool, like all good resolve.'
      ],
      photos: [
        seedPhoto('#6b1f2a', '#3d0f16', 'मथुरा के पेड़े', 'Nani’s pede'),
        seedPhoto('#1e5c57', '#0e2f2c', 'रेलगाड़ी की मिठास', 'the train from Mathura'),
      ],
      audio: null,
    },
    {
      id: uid(), createdAt: now + 1, order: now + 1, sample: true,
      title: 'Aloo Rasedar & Bedmi Puri',
      origin: 'Sunday mornings · Lucknow',
      category: 'Nashta · नाश्ता',
      serves: '4–6', time: '1 hr',
      story:
        'In our Lucknow house, Sunday began with the sound of the sil-batta and ended in a puddle of rasedar mopped up with the last bedmi. ' +
        'Papa insisted the aloo must be broken by hand, never cut — “the ras clings to the rough edges,” he said, as if telling us a secret of the universe. ' +
        'Perhaps he was.\nThis is a sample page — press ✎ to make it your own, or 🗑 to remove it.',
      ingredients: [
        '6 potatoes, boiled and hand-broken', '2 tomatoes, ground', '1 tbsp ginger, pounded',
        '2 green chillies', '1 tsp cumin', '½ tsp hing water', '1 tsp coriander powder',
        '½ tsp red chilli powder', '½ tsp garam masala', 'For the puri: 2 cups atta, ½ cup soaked urad dal, ground coarse, saunf & ginger'
      ],
      steps: [
        'Temper cumin and hing in hot ghee; add ginger, chillies and the ground tomato.',
        'Bhuno till the masala leaves the ghee at the edges.',
        'Add the hand-broken potatoes and enough water for a loose, flowing ras. Simmer.',
        'Finish with garam masala and coriander; the curry should be thin enough to drink, almost.',
        'Knead the dal paste into the atta, rest, roll thick puris and fry till they puff proud.',
        'Serve scalding, with a sliver of Banarasi achaar on the side.'
      ],
      photos: [seedPhoto('#8a4d1e', '#3f2009', 'रविवार का नाश्ता', 'Sunday bedmi-aloo')],
      audio: null,
    },
  ];
}

/* ─────────────────────── UI wiring ───────────────────────── */

function bindUI() {
  $('#btn-add').addEventListener('click', () => openRecipeModal(null));
  $('#btn-settings').addEventListener('click', () => {
    $('#s-family').value = state.settings.family || '';
    $('#s-dedication').value = state.settings.dedication || DEFAULT_DEDICATION;
    $('#settings-modal').hidden = false;
  });
  $('#settings-close').addEventListener('click', () => { $('#settings-modal').hidden = true; });
  $('#settings-save').addEventListener('click', async () => {
    state.settings.family = escapeless($('#s-family').value);
    state.settings.dedication = $('#s-dedication').value.trim() || DEFAULT_DEDICATION;
    await RB_DB.setSetting('settings', state.settings).catch(() => {});
    $('#settings-modal').hidden = true;
    toast('The dedication has been inscribed.');
    rebuildBook();
  });

  $('#btn-sound').addEventListener('click', (e) => {
    state.muted = !state.muted;
    e.currentTarget.textContent = state.muted ? '🔇' : '🔊';
    RB_DB.setSetting('muted', state.muted).catch(() => {});
  });

  $('#btn-pdf').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '⏳ Binding your PDF…';
    try {
      await RB_PDF.download(state);
      toast('Your book has been pressed into a PDF.');
    } catch (err) {
      console.error(err);
      toast('PDF failed: ' + (err && err.message || err), true);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  $('#nav-prev').addEventListener('click', goPrev);
  $('#nav-next').addEventListener('click', goNext);
  document.addEventListener('keydown', (e) => {
    if (!$('#recipe-modal').hidden || !$('#settings-modal').hidden) {
      if (e.key === 'Escape') { closeRecipeModal(); $('#settings-modal').hidden = true; }
      return;
    }
    if (e.key === 'ArrowLeft') goPrev();
    if (e.key === 'ArrowRight') goNext();
  });

  // modal chrome
  $('#recipe-modal-close').addEventListener('click', closeRecipeModal);
  $('#recipe-cancel').addEventListener('click', closeRecipeModal);
  $('#recipe-form').addEventListener('submit', saveRecipeFromForm);
  $('#recipe-delete').addEventListener('click', async () => {
    if (!editingId) return;
    const r = state.recipes.find(x => x.id === editingId);
    if (!confirm(`Remove “${r ? r.title : 'this recipe'}” from the book?`)) return;
    await RB_DB.deleteRecipe(editingId);
    state.recipes = state.recipes.filter(x => x.id !== editingId);
    closeRecipeModal();
    toast('Recipe removed from the book.');
    rebuildBook();
  });

  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // paste
  $('#paste-parse').addEventListener('click', () => {
    const text = $('#paste-box').value;
    if (!text.trim()) { toast('Paste a recipe first.', true); return; }
    applyParsed(parseRecipeText(text));
    switchTab('write');
    toast('Sorted into the recipe — please look it over.');
  });

  // voice
  $('#voice-btn').addEventListener('click', () => { recording ? stopVoice() : startVoice(); });
  $$('.row-end [data-voice-to]').forEach(b => b.addEventListener('click', () => {
    const text = $('#voice-transcript').value.trim();
    if (!text) { toast('Nothing transcribed yet.', true); return; }
    const to = b.dataset.voiceTo;
    if (to === 'auto') applyParsed(parseRecipeText(text));
    else {
      const map = { story: '#f-story', ingredients: '#f-ingredients', steps: '#f-steps' };
      const f = $(map[to]);
      f.value = f.value.trim() ? f.value.trimEnd() + '\n' + text : text;
    }
    switchTab('write');
  }));

  // files
  $('#file-any').addEventListener('change', (e) => { routeFiles(Array.from(e.target.files)); e.target.value = ''; });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => routeFiles(Array.from(e.dataTransfer.files)));

  // photos
  $('#f-photos').addEventListener('change', (e) => { addPhotoFiles(Array.from(e.target.files)); e.target.value = ''; });
  $('#audio-remove').addEventListener('click', () => { modalAudio = null; renderAudioBlock(); });

  // rebuild on resize (keeps place)
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => rebuildBook(), 320);
  });
}

/* ─────────────────────────── boot ────────────────────────── */

async function boot() {
  bindUI();
  try {
    state.settings = await RB_DB.getSetting('settings', state.settings);
    state.muted = await RB_DB.getSetting('muted', false);
    $('#btn-sound').textContent = state.muted ? '🔇' : '🔊';
    const seeded = await RB_DB.getSetting('seeded', false);
    state.recipes = await RB_DB.allRecipes();
    if (!seeded && state.recipes.length === 0) {
      const seeds = seedRecipes();
      for (const s of seeds) await RB_DB.saveRecipe(s);
      await RB_DB.setSetting('seeded', true);
      state.recipes = seeds;
    } else if (!seeded) {
      await RB_DB.setSetting('seeded', true);
    }
  } catch (e) {
    console.warn('Storage unavailable — running in-memory only.', e);
    toast('Heads-up: this browser is blocking storage; recipes won’t survive a refresh.', true);
    if (!state.recipes.length) state.recipes = seedRecipes();
  }
  rebuildBook(0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
