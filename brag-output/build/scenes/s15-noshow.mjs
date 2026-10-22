import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { scheda, rigaRichiamo, fattaLi } from '../ui.mjs';

// Capitolo 4 — il giorno della visita: «Non si è presentato» (No-show), e il lead non è perso.
export default async function () {
  const id = 's15';
  const dur = 10.6;
  const lista = [
    { t: 0.8, d: 4.5, h: 'Non si presenta? <b>«Non si è presentato»</b>: nel calendario si legge No-show.' },
    { t: 5.5, d: 4.0, h: 'Poi fissa un nuovo appuntamento: <b>il lead non è perso</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `#${id}-pg { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; }`;
  const riga = rigaRichiamo({ id: id + 'x', tipo: 'sede', quando: '15:00', fascia: false, noBtn: 'Non si è presentato', dett: 'Tour in sede e proposta abbonamento' });
  const html = scheda({
    id: id + 's', conLead: false,
    ora: riga, oraConto: 1,
    fatte: fattaLi({ id: id + 'n', tipo: 'sede', quando: 'sab 24 ott 2026', esito: 'No-show', cls: 'badge-ko', nota: 'Non si è presentato' }).replace('<li ', '<li style="opacity:0" ') +
      fattaLi({ nota: 'Vuole il tour sabato pomeriggio' }),
    fatteConto: 1, nuova: false,
  }).replace(/<div class="page-head"[\s\S]*?<\/div>\s*<\/div>/, '');
  const body = `<div class="cam" id="${id}-cam"><div class="frag" id="${id}-pg">${html}</div><div class="cur" id="${id}-cur">${CURSOR_SVG}</div></div>${c.html}`;
  const script =
    runtime(id) +
    `
    const ora = W('#${id}s-ora'), nr = W('#${id}x-nr'), fatte = W('#${id}s-fatte');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(ora.x, ora.y + 70, 2.0);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    curAt(nr.x + 160, nr.y + 100);
    curShow(1.6, true);
    curTo(1.7, 1.1, { x: nr.x, y: nr.y });
    tap(3.2); press(3.2, '#${id}x-nr');
    tl.to('#${id}x', { opacity: 0, duration: 0.3 }, 3.35);
    tl.set('#${id}s-ora-conto', { innerHTML: '0' }, 3.65);
    tl.set('#${id}x', { display: 'none' }, 3.7);
    curShow(3.6, false);
    view(3.9, 1.0, fatte.x, fatte.y + 40, 2.0);
    tl.set('#${id}s-fatte-conto', { innerHTML: '2' }, 4.9);
    tl.fromTo('#${id}n', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 4.9);
    ${c.js}
  `;
  const sfx = [{ t: 3.2, f: 'interface/click_003.ogg', v: 0.5 }, { t: 4.9, f: 'interface/drop_002.ogg', v: 0.35 }];
  return { id, dur, css, body, script, chapter: { n: '4', t: 'Lavorare un lead' }, sfx };
}
