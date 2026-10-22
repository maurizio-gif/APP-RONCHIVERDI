// Generatore dei file della composizione. Ogni scena è un modulo in build/scenes/ che usa questi attrezzi.
// Tutto ciò che si vede è scritto in HTML; il JS di scena costruisce solo la timeline GSAP (pausata, deterministica).

export const FONTS = `
    @font-face { font-family: 'Jost'; font-weight: 400; src: url('assets/fonts/jost-latin-400-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Jost'; font-weight: 500; src: url('assets/fonts/jost-latin-500-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Jost'; font-weight: 600; src: url('assets/fonts/jost-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Cormorant Garamond'; font-weight: 500; src: url('assets/fonts/cormorant-garamond-latin-500-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Cormorant Garamond'; font-weight: 600; src: url('assets/fonts/cormorant-garamond-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Cormorant Garamond'; font-weight: 700; src: url('assets/fonts/cormorant-garamond-latin-700-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Cormorant Garamond'; font-weight: 500; font-style: italic; src: url('assets/fonts/cormorant-garamond-latin-500-italic.woff2') format('woff2'); }
`;

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Parole visibili di un frammento HTML, per verificare il tempo di lettura. */
const parole = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).filter(Boolean).length;

/** CSS comune a tutte le scene (prefisso = id scena, per non collidere). */
export function baseCss(id) {
  return `
    #root { position: absolute; inset: 0; overflow: hidden; font-family: 'Jost', sans-serif; color: #17170f; }
    #${id}-all { position: absolute; inset: 0; }
    .stage { position: absolute; inset: 0; background: radial-gradient(ellipse 70% 62% at 50% 42%, #fbf8ee 0%, #f1ead8 58%, #e5dec8 100%); }
    .stage-dark { position: absolute; inset: 0; background: #1c1c18; }
    .view { position: absolute; left: 0; right: 0; top: 104px; bottom: 246px; overflow: hidden;
            -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 22px, #000 calc(100% - 26px), transparent 100%);
            mask-image: linear-gradient(to bottom, transparent 0, #000 22px, #000 calc(100% - 26px), transparent 100%); }
    .cam { position: absolute; left: 0; top: 0; width: 2600px; height: 1600px; transform-origin: 0 0; }
    .chap { position: absolute; left: 96px; top: 54px; font-family: 'Jost', sans-serif; font-weight: 500; font-size: 28px;
            letter-spacing: 0.14em; text-transform: uppercase; color: #6e5610; }
    .chap i { font-style: normal; color: #8b6c14; margin-right: 14px; }
    .caps { position: absolute; left: 96px; right: 96px; bottom: 100px; display: grid; justify-items: center; align-items: end; }
    .cap { grid-area: 1 / 1; max-width: 1560px; padding: 20px 40px 22px; border-radius: 16px; border-left: 7px solid #c8991f;
           background: rgba(28, 28, 24, 0.95); color: #f6efde; font-family: 'Jost', sans-serif; font-weight: 500; font-size: 40px;
           line-height: 1.22; letter-spacing: 0.002em; text-align: left; box-shadow: 0 14px 40px rgba(28, 28, 24, 0.25); opacity: 0; }
    .cap b { font-weight: 600; color: #efbf48; }
    .cur { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; transform-origin: 0 0; z-index: 900; pointer-events: none; }
    .cur-in { position: absolute; left: -2px; top: -2px; width: 22px; height: 30px; transform-origin: 2px 2px; }
    .cur-in svg { display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    .frag { position: absolute; background: var(--bg); border-radius: 12px; box-shadow: 0 24px 60px rgba(28, 28, 24, 0.20), 0 0 0 1px rgba(28,28,24,.10); overflow: hidden; }
    .tapa { outline: 3px solid rgba(200,153,31,.0); }
  `;
}

export const CURSOR_SVG = `<div class="cur-in"><svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16 26.5 L11.6 17.2 L19.5 17 Z" fill="#17170f" stroke="#fdfaf3" stroke-width="2" stroke-linejoin="round"/></svg></div>`;

/** Sottotitoli: lista {t, d, h}. Verifica il tempo di lettura (0.5 s + 0.3 s a parola, ultima riga ≥ 2 s). */
export function caps(id, lista, durScena) {
  const html = lista
    .map((c, i) => {
      const w = parole(c.h);
      const minimo = 0.5 + 0.3 * w;
      if (c.d + 0.001 < minimo) console.warn(`  ⚠ ${id} cap${i} (${w} parole) dura ${c.d}s, minimo ${minimo.toFixed(2)}s`);
      if (c.t + c.d > durScena + 0.001) console.warn(`  ⚠ ${id} cap${i} finisce a ${(c.t + c.d).toFixed(2)}s oltre la scena (${durScena}s)`);
      return `<div class="cap" id="${id}-cap${i}">${c.h}</div>`;
    })
    .join('\n      ');
  const js = lista
    .map(
      (c, i) => `
    tl.fromTo('#${id}-cap${i}', { opacity: 0, y: 16, filter: 'blur(7px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.26, ease: 'power3.out' }, ${c.t});
    tl.to('#${id}-cap${i}', { opacity: 0, filter: 'blur(7px)', duration: 0.18, ease: 'power3.in' }, ${(c.t + c.d - 0.18).toFixed(3)});`
    )
    .join('');
  return { html: `<div class="caps">\n      ${html}\n    </div>`, js };
}

/** Testo da "scrivere": ogni carattere in uno span, rivelato a stagger. Restituisce l'HTML. */
export const typed = (testo) =>
  [...testo].map((c) => `<span style="opacity:0">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');

/** Attrezzi runtime inseriti all'inizio dello script di ogni scena. */
export function runtime(id, { cam = true } = {}) {
  const r = String.raw`
    const tl = gsap.timeline({ paused: true });
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);
    const CAM = $('#__ID__-cam');
    const CUR = $('#__ID__-cur');
    const CX = 960, CY = 365, CB = 1.5;
    // Coordinate "mondo" di un elemento (centro di default), indipendenti dalla camera attuale.
    function W(sel, fx, fy) {
      fx = fx === undefined ? 0.5 : fx; fy = fy === undefined ? 0.5 : fy;
      const e = $(sel), r = e.getBoundingClientRect(), c = CAM.getBoundingClientRect();
      const k = (c.width / CAM.offsetWidth) || 1;
      return { x: (r.left - c.left + r.width * fx) / k, y: (r.top - c.top + r.height * fy) / k };
    }
    let camS = 1;
    // Mette al centro dell'area libera (sopra i sottotitoli) il centro di un elemento, a scala s.
    function centerOn(sel, s, dx, dy) { const p = W(sel); viewSet(p.x + (dx || 0), p.y + (dy || 0), s); return p; }
    function viewSet(wx, wy, s) {
      camS = s;
      gsap.set(CAM, { x: CX - wx * s, y: CY - wy * s, scale: s });
      if (CUR) gsap.set(CUR, { scale: CB / s });
    }
    function view(t, d, wx, wy, s, ease) {
      ease = ease || 'power2.inOut';
      tl.to(CAM, { x: CX - wx * s, y: CY - wy * s, scale: s, duration: d, ease: ease }, t);
      if (CUR) tl.to(CUR, { scale: CB / s, duration: d, ease: ease }, t);
      camS = s;
    }
    // Il cursore: compare, si muove verso un punto del mondo, "clicca".
    function curAt(x, y) { gsap.set(CUR, { x: x, y: y, scale: CB / camS }); }
    function curShow(t, on) { tl.to(CUR, { opacity: on === false ? 0 : 1, duration: 0.2 }, t); }
    function curTo(t, d, p, ease) { tl.to(CUR, { x: p.x, y: p.y, duration: d, ease: ease || 'power3.inOut' }, t); }
    function tap(t) {
      const ci = CUR.firstElementChild;
      tl.to(ci, { scale: 0.8, duration: 0.07, ease: 'power2.out' }, t);
      tl.to(ci, { scale: 1, duration: 0.14, ease: 'power2.out' }, t + 0.07);
    }
    function press(t, sel) {
      tl.to(sel, { scale: 0.96, duration: 0.07, ease: 'power2.out', transformOrigin: '50% 50%' }, t);
      tl.to(sel, { scale: 1, duration: 0.16, ease: 'power2.out' }, t + 0.07);
    }
    // Scrive un testo già diviso in span (vedi typed()): un carattere ogni 1/cps secondi.
    function write(t, sel, cps) {
      const sp = $$(sel + ' > span');
      tl.to(sp, { opacity: 1, duration: 0.01, stagger: 1 / (cps || 16) }, t);
      return t + sp.length / (cps || 16);
    }
    // Entrata/uscita della scena: dissolvenza morbida.
    function sceneInOut(dur, tin, tout) {
      tin = tin === undefined ? 0.35 : tin; tout = tout === undefined ? 0.35 : tout;
      if (tin > 0) tl.fromTo('#__ID__-all', { opacity: 0 }, { opacity: 1, duration: tin, ease: 'power2.out' }, 0);
      tl.to('#__ID__-all', { opacity: 0, duration: tout, ease: 'power2.in' }, dur - tout);
    }
  `;
  return r.replaceAll('__ID__', id);
}

/** Avvolge il blocco .cam in una finestra .view (ritaglia sotto la fascia del capitolo) e marca i frammenti come «hold di lettura». */
function avvolgiCam(body) {
  const inizio = body.indexOf('<div class="cam"');
  if (inizio < 0) return body;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = inizio;
  let profondita = 0, fine = -1, m;
  while ((m = re.exec(body))) {
    profondita += m[0] === '</div>' ? -1 : 1;
    if (profondita === 0) { fine = m.index + m[0].length; break; }
  }
  const camHtml = body.slice(inizio, fine).replace('<div class="cam"', '<div class="cam" data-layout-allow-overflow').replace(/<div class="frag"/g, '<div class="frag" data-hold');
  return body.slice(0, inizio) + '<div class="view">' + camHtml + '</div>' + body.slice(fine);
}

/** Struttura completa di un file di scena. */
export function sceneFile({ id, dur, css = '', body = '', script = '', chapter = null, dark = false, camera = true, extraRoot = '' }) {
  const chap = chapter ? `<div class="chap"><i>${esc(chapter.n)}</i>${esc(chapter.t)}</div>` : '';
  return `<template>
  <style>${FONTS}${baseCss(id)}${css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
    <div id="${id}-all">
      <div class="${dark ? 'stage-dark' : 'stage'}" id="${id}-bg"></div>
      ${chap}
      ${avvolgiCam(body)}
    </div>
    ${extraRoot}
  </div>
  <script>
    ${script}
    window.__timelines['${id}'] = tl;
  </script>
</template>
`;
}
