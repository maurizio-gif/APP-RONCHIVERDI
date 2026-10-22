import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { sidebar, calendarioGiorno, datiGiorno } from '../ui.mjs';

// Capitolo 3 — il menu: «Core New» e il clic su Agenda.
export default async function () {
  const id = 's05';
  const dur = 8;
  const lista = [
    { t: 0.7, d: 4.2, h: 'Core New: <b>Dashboard New, Agenda, Contatti</b>. Le voci di ogni giorno.' },
    { t: 5.0, d: 2.6, h: 'Clicca <b>Agenda</b>: si apre il calendario.' },
  ];
  const c = caps(id, lista, dur);
  const d = datiGiorno(id + 'a');
  const css = `
    #${id}-side { left: 40px; top: 20px; position: absolute; border-radius: 10px; box-shadow: 0 24px 60px rgba(28,28,24,.28); overflow: hidden; }
    #${id}-pg { left: 330px; top: 20px; width: 800px; padding: 18px; opacity: 0; }
  `;
  const cal = calendarioGiorno({
    id: id + 'a', attivi: ['elena'], conti: d.conti, eventiPer: d.eventiPer, chipPer: d.chipPer,
    legenda: { dafare: 2, ritardo: 1, fatto: 1, sede: 3, tel: 0 },
  });
  const body = `
      <div class="cam" id="${id}-cam">
        ${sidebar({ id: id + '-side', attivo: 'dashboard', altezza: 760 })}
        <div class="frag" id="${id}-pg">${cal}</div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const gr = W('#${id}-side-n-dash', 0.5, 0.5), ag = W('#${id}-side-n-agenda', 0.5, 0.5), core = W('#${id}-side .nav-gruppo');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(560, core.y + 40, 1.7);
    tl.fromTo('#${id}-side', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    // Il cursore scende su «Agenda» e clicca: la voce attiva passa da Dashboard New ad Agenda.
    curAt(ag.x + 120, ag.y - 90);
    curShow(3.4, true);
    curTo(3.5, 1.2, { x: ag.x + 40, y: ag.y });
    tap(5.0);
    tl.set('#${id}-side-n-dash', { className: 'nav-item' }, 5.05);
    tl.set('#${id}-side-n-agenda', { className: 'nav-item is-active' }, 5.05);
    tl.fromTo('#${id}-pg', { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' }, 5.25);
    curShow(5.6, false);
    ${c.js}
  `;
  const sfx = [{ t: 5.0, f: 'interface/click_003.ogg', v: 0.5 }, { t: 5.3, f: 'interface/drop_001.ogg', v: 0.35 }];
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx };
}
