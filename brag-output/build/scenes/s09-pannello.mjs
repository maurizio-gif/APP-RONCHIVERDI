import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { calendarioGiorno, datiGiorno, dettaglio } from '../ui.mjs';

// Capitolo 3 — il clic su una voce apre un riepilogo in sola lettura; «Gestisci» porta alla scheda.
export default async function () {
  const id = 's09';
  const dur = 11.5;
  const lista = [
    { t: 2.6, d: 4.2, h: 'Il riepilogo è <b>in sola lettura</b>: l’azione si gestisce nella scheda.' },
    { t: 7.4, d: 3.8, h: '«Gestisci» apre la scheda in <b>una nuova scheda</b> del browser.' },
  ];
  const c = caps(id, lista, dur);
  const a = datiGiorno(id + 'a');
  const cal = calendarioGiorno({ id: id + 'a', attivi: ['elena'], conti: a.conti, eventiPer: a.eventiPer, chipPer: a.chipPer, legenda: { dafare: 2, ritardo: 1, fatto: 1, sede: 3, tel: 0 } });
  const css = `
    #${id}-A { left: 40px; top: 20px; width: 800px; height: 940px; padding: 18px; }
    #${id}-velo { position: absolute; inset: 0; background: rgba(28,28,24,0.28); opacity: 0; }
    #${id}-pan { position: absolute; top: 0; right: 0; width: 420px; height: 600px; }
    #${id}-pan .agt-dettaglio { height: 600px; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-A">${cal}
          <div id="${id}-velo"></div>
          <div id="${id}-pan" data-layout-allow-occlusion data-layout-allow-overlap>${dettaglio({ id: id + '-det' })}</div>
        </div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const chip = W('#${id}a-chip', 0.3, 0.5), pan = W('#${id}-pan', 0.5, 0.0), foot = W('#${id}-det-gestisci'), panB = W('#${id}-pan', 0.5, 0.0);
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(chip.x + 120, chip.y + 40, 2.2);
    tl.fromTo('#${id}-A', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.1);
    curAt(chip.x + 260, chip.y + 140);
    curShow(0.7, true);
    curTo(0.8, 0.9, { x: chip.x, y: chip.y });
    tap(1.9);
    tl.fromTo('#${id}-velo', { opacity: 0 }, { opacity: 1, duration: 0.25 }, 2.0);
    tl.fromTo('#${id}-pan', { x: 440, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 2.05);
    curShow(2.3, false);
    view(2.4, 1.0, pan.x - 10, pan.y + 235, 2.15);
    // dopo la lettura, la camera scende sul piede e il cursore va su «Gestisci»
    view(6.4, 0.9, panB.x - 10, panB.y + 470, 2.15);
    curAt(foot.x + 90, foot.y + 120);
    curShow(6.9, true);
    curTo(7.0, 0.9, { x: foot.x, y: foot.y });
    tap(8.4);
    tl.to('#${id}-det-gestisci', { backgroundColor: '#6e5610', duration: 0.2 }, 8.4);
    ${c.js}
  `;
  const sfx = [{ t: 1.9, f: 'interface/click_003.ogg', v: 0.5 }, { t: 2.1, f: 'ui/rollover2.ogg', v: 0.35 }, { t: 8.4, f: 'interface/click_002.ogg', v: 0.5 }];
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx };
}
