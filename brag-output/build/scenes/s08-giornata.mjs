import { runtime, caps } from '../lib.mjs';
import { calendarioGiorno, datiGiorno } from '../ui.mjs';

// Capitolo 3 — «in giornata»: il Richiamami non ha un'ora, ha una fascia.
export default async function () {
  const id = 's08';
  const dur = 10;
  const lista = [
    { t: 0.9, d: 3.2, h: 'Il Richiamami non ha un’ora: <b>ha una fascia</b>.' },
    { t: 4.5, d: 5.0, h: 'Mattina 9–13, Pomeriggio 13–17, <b>Sera 17–20</b>: la persona sceglie quando essere chiamata.' },
  ];
  const c = caps(id, lista, dur);
  const a = datiGiorno(id + 'a');
  const cal = calendarioGiorno({ id: id + 'a', attivi: ['elena'], conti: a.conti, eventiPer: a.eventiPer, chipPer: a.chipPer, legenda: { dafare: 2, ritardo: 1, fatto: 1, sede: 3, tel: 0 } });
  const css = `#${id}-A { left: 40px; top: 20px; width: 800px; padding: 18px; }`;
  const body = `<div class="cam" id="${id}-cam"><div class="frag" id="${id}-A">${cal}</div></div>${c.html}`;
  const script =
    runtime(id) +
    `
    const chip = W('#${id}a-chip'), giorn = W('#${id}a-cal .agt-giornata', 0.5, 0.5), lab = W('#${id}a-chip .agt-fascia');
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set('#${id}a-chip', { outline: '0px solid #17170f', outlineOffset: '2px' });
    viewSet(chip.x - 40, chip.y + 40, 2.6);
    tl.fromTo('#${id}-A', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.1);
    tl.to('#${id}a-chip', { outlineWidth: 4, duration: 0.25, ease: 'power2.out' }, 1.0);
    view(4.0, 1.2, chip.x + 60, chip.y + 70, 2.9);
    tl.to('#${id}a-chip', { outlineWidth: 0, duration: 0.3 }, 9.2);
    ${c.js}
  `;
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx: [] };
}
