import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { calendarioSettimana } from '../ui.mjs';

// Capitolo 3 — la vista Settimana.
export default async function () {
  const id = 's10';
  const dur = 8;
  const lista = [
    { t: 0.8, d: 3.0, h: 'Settimana: sette colonne, <b>oggi evidenziato</b>.' },
    { t: 4.2, d: 3.8, h: 'Un clic su un giorno e torni alla <b>vista Giorno</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `#${id}-W { left: 40px; top: 20px; width: 900px; padding: 18px; }`;
  const body = `<div class="cam" id="${id}-cam"><div class="frag" id="${id}-W">${calendarioSettimana({ id: id + 'w' })}</div><div class="cur" id="${id}-cur">${CURSOR_SVG}</div></div>${c.html}`;
  const script =
    runtime(id) +
    `
    const cal = W('#${id}w-cal'), oggi = W('#${id}w-g22');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(cal.x, cal.y + 20, 1.85);
    tl.fromTo('#${id}-W', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.1);
    curAt(oggi.x + 160, oggi.y + 190);
    curShow(4.4, true);
    curTo(4.5, 1.0, { x: oggi.x + 6, y: oggi.y + 4 });
    tap(5.8);
    tl.to('#${id}w-g22', { backgroundColor: 'rgba(139,108,20,0.18)', duration: 0.2 }, 5.8);
    ${c.js}
  `;
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx: [{ t: 5.8, f: 'interface/click_003.ogg', v: 0.5 }] };
}
