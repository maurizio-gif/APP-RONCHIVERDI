import { runtime, caps } from '../lib.mjs';
import { calendarioGiorno, datiGiorno } from '../ui.mjs';

// Capitolo 3 — i tre stati di una voce: da fare (oro), in ritardo (rosso), fatta (verde).
export default async function () {
  const id = 's07';
  const dur = 12.8;
  const lista = [
    { t: 1.0, d: 3.0, h: '<b>Da fare</b>: oro, con il cerchio vuoto.' },
    { t: 4.5, d: 3.6, h: '<b>In ritardo</b>: l’ora è passata e manca l’esito.' },
    { t: 8.6, d: 3.6, h: '<b>Fatta</b>: verde, con la spunta e com’è andata.' },
  ];
  const c = caps(id, lista, dur);
  const a = datiGiorno(id + 'a');
  const cal = calendarioGiorno({ id: id + 'a', attivi: ['elena'], conti: a.conti, eventiPer: a.eventiPer, chipPer: a.chipPer, legenda: { dafare: 2, ritardo: 1, fatto: 1, sede: 3, tel: 0 } });
  const css = `#${id}-A { left: 40px; top: 20px; width: 800px; padding: 18px; }`;
  const body = `
      <div class="cam" id="${id}-cam"><div class="frag" id="${id}-A">${cal}</div></div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const ev = { dafare: W('#${id}a-e-dafare'), ritardo: W('#${id}a-e-ritardo'), fatto: W('#${id}a-e-fatta') };
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set('.agt-ev', { outline: '0px solid #17170f', outlineOffset: '2px' });
    viewSet(ev.dafare.x, ev.dafare.y - 40, 2.35);
    tl.fromTo('#${id}-A', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.1);
    const evid = (k) => '#${id}a-' + { dafare: 'e-dafare', ritardo: 'e-ritardo', fatto: 'e-fatta' }[k];
    function pulsa(t, k, fine) {
      tl.to(evid(k), { outlineWidth: 4, duration: 0.25, ease: 'power2.out' }, t);
      tl.to(evid(k), { outlineWidth: 0, duration: 0.3, ease: 'power2.in' }, fine);
    }
    pulsa(0.9, 'dafare', 4.2);
    view(4.1, 0.9, ev.ritardo.x, ev.ritardo.y - 10, 2.35);
    pulsa(4.4, 'ritardo', 8.3);
    view(8.2, 0.9, ev.fatto.x, ev.fatto.y + 30, 2.35);
    pulsa(8.5, 'fatto', 12.3);
    ${c.js}
  `;
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx: [] };
}
