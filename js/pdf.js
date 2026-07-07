/* ════════════════════════════════════════════════════════════
   PDF binding — presses the recipe book into a downloadable PDF
   using jsPDF (vendored). Vector borders echo the on-screen
   zardozi frames; photos are laid in with gold rules.
   ════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const W = 432, H = 576;               // 6in × 8in book page, pt
const M = 48;                          // outer margin
const CW = W - M * 2;                  // content width
const FOOT = H - 44;                   // baseline limit

const MAROON = [74, 17, 25];
const MAROON2 = [107, 31, 42];
const GOLD = [156, 124, 46];
const GOLD2 = [201, 165, 72];
const IVORY = [246, 237, 219];
const INK = [61, 43, 33];
const INKSOFT = [109, 85, 69];
const TEAL = [30, 92, 87];

/* jsPDF core fonts are Latin-1 only: soften typography, drop Devanagari. */
function clean(s) {
  return String(s || '')
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/—|–/g, '-').replace(/…/g, '...')
    .replace(/।/g, '.').replace(/·/g, '-')
    .replace(/[^\x00-\xFF]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/ ?- ?$/,'').trim();
}
function catOf(r) { return clean((r.category || 'Recipe').split('·')[0]); }

function loadImg(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function pageTemplate(doc) {
  doc.setFillColor(...IVORY);
  doc.rect(0, 0, W, H, 'F');
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.4);
  doc.rect(M - 22, M - 22, W - 2 * (M - 22), H - 2 * (M - 22));
  doc.setLineWidth(0.5);
  doc.rect(M - 17, M - 17, W - 2 * (M - 17), H - 2 * (M - 17));
  // corner dots
  doc.setFillColor(...GOLD);
  [[M - 22, M - 22], [W - M + 22, M - 22], [M - 22, H - M + 22], [W - M + 22, H - M + 22]]
    .forEach(([x, y]) => doc.circle(x, y, 2, 'F'));
}

function folio(doc, n) {
  doc.setFont('times', 'normal'); doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text(String(n), W / 2, H - 26, { align: 'center' });
}

function ornament(doc, y) {
  const cx = W / 2;
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8);
  doc.line(M + 30, y, cx - 16, y); doc.line(cx + 16, y, W - M - 30, y);
  doc.setFillColor(...GOLD2);
  doc.lines([[8, 8], [-8, 8], [-8, -8], [8, -8]], cx, y - 8, [1, 1], 'FD', true);
}

class Binder {
  constructor(doc) { this.doc = doc; this.n = 1; this.y = M + 8; }
  newPage() { this.doc.addPage(); this.n++; pageTemplate(this.doc); folio(this.doc, this.n); this.y = M + 8; }
  ensure(need) { if (this.y + need > FOOT) this.newPage(); }
}

function drawCover(doc, settings) {
  doc.setFillColor(...MAROON); doc.rect(0, 0, W, H, 'F');
  doc.setDrawColor(...GOLD2); doc.setLineWidth(2);
  doc.rect(26, 26, W - 52, H - 52);
  doc.setLineWidth(0.7); doc.rect(33, 33, W - 66, H - 66);
  doc.setDrawColor(...GOLD2); doc.setLineWidth(1.4);
  doc.circle(W / 2, 200, 46, 'S');
  doc.circle(W / 2, 200, 52, 'S');
  // paisley hint inside the medallion
  doc.setLineWidth(1.2);
  doc.ellipse(W / 2 - 4, 200, 18, 26, 'S');
  doc.circle(W / 2 - 4, 210, 4, 'S');
  doc.setTextColor(...GOLD2);
  doc.setFont('times', 'italic'); doc.setFontSize(13);
  doc.text('Rasoi ki Virasat - the heritage of our kitchen', W / 2, 292, { align: 'center' });
  doc.setFont('times', 'bold'); doc.setFontSize(27);
  doc.setTextColor(...IVORY);
  doc.text('The Family Recipe Book', W / 2, 330, { align: 'center' });
  const fam = clean(settings.family);
  doc.setFont('times', 'italic'); doc.setFontSize(15);
  doc.setTextColor(...GOLD2);
  doc.text(fam ? `of the ${fam} family` : 'of our family', W / 2, 356, { align: 'center' });
  doc.setFont('times', 'normal'); doc.setFontSize(10);
  doc.setCharSpace && doc.setCharSpace(2);
  doc.text('SWAD  -  VIRASAT  -  PARIVAAR', W / 2, 470, { align: 'center' });
  doc.setCharSpace && doc.setCharSpace(0);
}

function drawDedication(doc, settings, n) {
  pageTemplate(doc); folio(doc, n);
  doc.setFont('times', 'italic'); doc.setFontSize(12);
  doc.setTextColor(...MAROON2);
  doc.text('In honour of Annapurna, and of our elders', W / 2, 150, { align: 'center' });
  const fam = clean(settings.family);
  doc.setFont('times', 'bold'); doc.setFontSize(17);
  doc.setTextColor(...MAROON);
  doc.text(fam ? `The ${fam} Family` : 'Our Family', W / 2, 182, { align: 'center' });
  ornament(doc, 204);
  doc.setFont('times', 'italic'); doc.setFontSize(12.5);
  doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(clean(settings.dedication).replace(/\n/g, ' \n'), CW - 40);
  doc.text(lines, W / 2, 240, { align: 'center', lineHeightFactor: 1.6 });
}

async function drawRecipe(b, r) {
  const doc = b.doc;
  b.newPage();
  const startPage = b.n;

  // header
  doc.setFont('times', 'normal'); doc.setFontSize(9);
  doc.setTextColor(...TEAL);
  doc.setCharSpace && doc.setCharSpace(2.4);
  doc.text(catOf(r).toUpperCase(), W / 2, b.y + 4, { align: 'center' });
  doc.setCharSpace && doc.setCharSpace(0);
  b.y += 22;
  doc.setFont('times', 'bold'); doc.setFontSize(21);
  doc.setTextColor(...MAROON);
  const titleLines = doc.splitTextToSize(clean(r.title), CW);
  doc.text(titleLines, W / 2, b.y, { align: 'center' });
  b.y += titleLines.length * 22;
  if (r.origin) {
    doc.setFont('times', 'italic'); doc.setFontSize(11.5);
    doc.setTextColor(...INKSOFT);
    doc.text('from the kitchen of ' + clean(r.origin), W / 2, b.y, { align: 'center' });
    b.y += 14;
  }
  ornament(doc, b.y + 4); b.y += 22;

  // meta chips
  const servesTxt = r.serves ? (/^(makes|serves|for)\b/i.test(r.serves) ? r.serves : 'serves ' + r.serves) : '';
  const meta = [servesTxt, r.time].filter(Boolean).map(clean).join('   ~   ');
  if (meta) {
    doc.setFont('times', 'italic'); doc.setFontSize(10.5);
    doc.setTextColor(...TEAL);
    doc.text(meta, W / 2, b.y, { align: 'center' });
    b.y += 18;
  }

  // story
  if (r.story) {
    doc.setFont('times', 'italic'); doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    const paras = clean(r.story.replace(/\n+/g, ' ')).trim();
    const lines = doc.splitTextToSize(paras, CW);
    for (const ln of lines) {
      b.ensure(16);
      doc.setFont('times', 'italic'); doc.setFontSize(11.5); doc.setTextColor(...INK);
      doc.text(ln, M, b.y);
      b.y += 15.5;
    }
    b.y += 4;
  }
  if (r.audio) {
    b.ensure(14);
    doc.setFont('times', 'italic'); doc.setFontSize(9.5);
    doc.setTextColor(...INKSOFT);
    doc.text('~ a voice recording accompanies this recipe in the app ~', W / 2, b.y, { align: 'center' });
    b.y += 16;
  }

  // hero photo
  const photos = r.photos || [];
  if (photos.length) {
    const im = await loadImg(photos[0]);
    if (im) {
      const maxW = 210, maxH = 190;
      const s = Math.min(maxW / im.width, maxH / im.height);
      const iw = im.width * s, ih = im.height * s;
      b.ensure(ih + 18);
      const x = (W - iw) / 2;
      doc.setDrawColor(...GOLD2); doc.setLineWidth(2.4);
      doc.rect(x - 3, b.y - 3, iw + 6, ih + 6);
      try { doc.addImage(photos[0], 'JPEG', x, b.y, iw, ih); } catch (e) { /* skip bad image */ }
      b.y += ih + 18;
    }
  }

  // ingredients
  const secHead = (label) => {
    b.ensure(34);
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
    doc.line(M, b.y + 3, M + 40, b.y + 3);
    doc.line(W - M - 40, b.y + 3, W - M, b.y + 3);
    doc.setFont('times', 'bold'); doc.setFontSize(12);
    doc.setTextColor(...MAROON2);
    doc.setCharSpace && doc.setCharSpace(2);
    doc.text(label.toUpperCase(), W / 2, b.y + 6, { align: 'center' });
    doc.setCharSpace && doc.setCharSpace(0);
    b.y += 24;
  };

  if ((r.ingredients || []).length) {
    secHead('Ingredients');
    doc.setFont('times', 'normal'); doc.setFontSize(11);
    for (const ing of r.ingredients) {
      const lines = doc.splitTextToSize(clean(ing), CW - 16);
      b.ensure(lines.length * 14 + 2);
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(...INK);
      doc.setFillColor(221, 143, 46);
      doc.circle(M + 4, b.y - 3, 1.6, 'F');
      doc.text(lines, M + 14, b.y);
      b.y += lines.length * 14 + 2;
    }
    b.y += 6;
  }

  // method
  if ((r.steps || []).length) {
    secHead('Method');
    r.steps.forEach((s, i) => {
      const lines = b.doc.splitTextToSize(clean(s), CW - 26);
      b.ensure(lines.length * 15 + 6);
      doc.setDrawColor(...GOLD); doc.setLineWidth(0.7);
      doc.circle(M + 7, b.y - 3.5, 7.5, 'S');
      doc.setFont('times', 'bold'); doc.setFontSize(9.5);
      doc.setTextColor(...MAROON2);
      doc.text(String(i + 1), M + 7, b.y - 0.5, { align: 'center' });
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(...INK);
      doc.text(lines, M + 22, b.y);
      b.y += lines.length * 15 + 6;
    });
  }

  // remaining photos, two to a row
  const rest = photos.slice(1);
  if (rest.length) {
    secHead('Yaadein - memories');
    for (let i = 0; i < rest.length; i += 2) {
      const pair = rest.slice(i, i + 2);
      const imgs = await Promise.all(pair.map(loadImg));
      const cellW = (CW - 16) / 2, cellH = 128;
      let rowH = 0;
      imgs.forEach((im) => {
        if (!im) return;
        const s = Math.min(cellW / im.width, cellH / im.height);
        rowH = Math.max(rowH, im.height * s);
      });
      if (!rowH) continue;
      b.ensure(rowH + 16);
      imgs.forEach((im, k) => {
        if (!im) return;
        const s = Math.min(cellW / im.width, cellH / im.height);
        const iw = im.width * s, ih = im.height * s;
        const x = M + k * (cellW + 16) + (cellW - iw) / 2;
        doc.setDrawColor(...GOLD2); doc.setLineWidth(1.8);
        doc.rect(x - 2, b.y - 2, iw + 4, ih + 4);
        try { doc.addImage(pair[k], 'JPEG', x, b.y, iw, ih); } catch (e) { /* skip */ }
      });
      b.y += rowH + 16;
    }
  }

  return startPage;
}

function drawToc(doc, entries, tocStart, tocPages, perPage) {
  for (let p = 0; p < tocPages; p++) {
    doc.setPage(tocStart + p);
    doc.setFont('times', 'bold'); doc.setFontSize(17);
    doc.setTextColor(...MAROON);
    doc.setCharSpace && doc.setCharSpace(3);
    doc.text('ANUKRAMANIKA', W / 2, M + 30, { align: 'center' });
    doc.setCharSpace && doc.setCharSpace(0);
    doc.setFont('times', 'italic'); doc.setFontSize(10.5);
    doc.setTextColor(...INKSOFT);
    doc.text('the recipes within', W / 2, M + 46, { align: 'center' });
    ornament(doc, M + 60);

    let y = M + 88;
    entries.slice(p * perPage, (p + 1) * perPage).forEach((e) => {
      doc.setFont('times', 'normal'); doc.setFontSize(12);
      doc.setTextColor(...INK);
      let name = clean(e.title);
      if (name.length > 44) name = name.slice(0, 43) + '…';
      doc.text(name, M, y);
      doc.setFont('times', 'bold');
      doc.setTextColor(...MAROON2);
      doc.text(String(e.page), W - M, y, { align: 'right' });
      const nameW = doc.getTextWidth(name) + 6;
      const numW = 20;
      doc.setDrawColor(...INKSOFT); doc.setLineWidth(0.4);
      doc.setLineDashPattern && doc.setLineDashPattern([1, 2], 0);
      doc.line(M + nameW, y - 1, W - M - numW, y - 1);
      doc.setLineDashPattern && doc.setLineDashPattern([], 0);
      doc.setFont('times', 'italic'); doc.setFontSize(9);
      doc.setTextColor(...INKSOFT);
      doc.text(clean(catOf(e.r)) + (e.r.origin ? '  -  ' + clean(e.r.origin) : ''), M + 8, y + 11);
      y += 28;
    });
  }
}

async function download(state) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: [W, H], compress: true });
  doc.setProperties({
    title: 'The Family Recipe Book - Rasoi ki Virasat',
    creator: 'MyRecipeBox',
  });

  drawCover(doc, state.settings);           // page 1

  doc.addPage();                             // page 2: dedication
  drawDedication(doc, state.settings, 2);

  const perPage = 15;
  const recipes = state.recipes || [];
  const tocPages = Math.max(1, Math.ceil(recipes.length / perPage));
  const tocStart = 3;
  for (let i = 0; i < tocPages; i++) {       // reserve TOC pages
    doc.addPage();
    pageTemplate(doc); folio(doc, tocStart + i);
  }

  const b = new Binder(doc);
  b.n = tocStart + tocPages - 1;             // Binder.newPage() will addPage from here

  const entries = [];
  for (const r of recipes) {
    const page = await drawRecipe(b, r);
    entries.push({ title: r.title, page, r });
  }

  if (!recipes.length) {
    b.newPage();
    doc.setFont('times', 'italic'); doc.setFontSize(13);
    doc.setTextColor(...INKSOFT);
    doc.text('The pages of this book are waiting for your first recipe.', W / 2, H / 2, { align: 'center' });
  }

  // closing page
  b.newPage();
  doc.setFont('times', 'bold'); doc.setFontSize(16);
  doc.setTextColor(...MAROON);
  doc.text('~ Samaapt ~', W / 2, H / 2 - 14, { align: 'center' });
  doc.setFont('times', 'italic'); doc.setFontSize(11.5);
  doc.setTextColor(...INKSOFT);
  doc.text('The story continues in your kitchen.', W / 2, H / 2 + 8, { align: 'center' });

  drawToc(doc, entries, tocStart, tocPages, perPage);

  const fam = (state.settings.family || 'family').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'family';
  doc.save(fam + '-recipe-book.pdf');
}

window.RB_PDF = { download };
})();
