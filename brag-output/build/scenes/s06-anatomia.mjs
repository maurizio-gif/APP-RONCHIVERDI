import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { calendarioGiorno, datiGiorno } from '../ui.mjs';

// Capitolo 3 — l'anatomia del calendario: comandi, arretrati, operatori. Tour della camera, un gesto su «Tutti».
export default async function () {
  const id = 's06';
  const dur = 24;
  const lista = [
    { t: 2.5, d: 4.2, h: 'Giorno o Settimana, ‹ Oggi › e <b>Vista elenco</b>, quando serve.' },
    { t: 7.8, d: 4.2, h: 'Le azioni arretrate hanno un link: <b>ci vai con un clic</b>.' },
    { t: 13.0, d: 4.5, h: 'All’apertura vedi solo le <b>tue</b> azioni. Spunta «Tutti» per i colleghi.' },
    { t: 18.9, d: 4.4, h: 'Senza assegnatario: se il numero è rosso, <b>c’è qualcuno da prendere</b>.' },
  ];
  const c = caps(id, lista, dur);
  const a = datiGiorno(id + 'a'), b = datiGiorno(id + 'b');
  const calA = calendarioGiorno({ id: id + 'a', attivi: ['elena'], conti: a.conti, eventiPer: a.eventiPer, chipPer: a.chipPer, legenda: { dafare: 2, ritardo: 1, fatto: 1, sede: 3, tel: 0 } });
  const calB = calendarioGiorno({ id: id + 'b', attivi: ['elena', 'marco', 'senza'], tutti: true, conti: b.conti, eventiPer: b.eventiPer, chipPer: b.chipPer, legenda: { dafare: 4, ritardo: 1, fatto: 2, sede: 5, tel: 1 } });
  const css = `
    #${id}-A, #${id}-B { left: 40px; top: 20px; width: 800px; padding: 18px; }
    #${id}-B { opacity: 0; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-A">${calA}</div>
        <div class="frag" id="${id}-B">${calB}</div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const fr = W('#${id}-A'), head = W('#${id}a-testa'), mese = W('#${id}a-mese'), arr = W('#${id}a-arretrati'), op = W('#${id}a-op'),
          tutti = W('#${id}a-tutti', 0.18, 0.5), cal = W('#${id}a-cal'), calB = W('#${id}b-cal');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(fr.x, fr.y + 6, 0.8);
    tl.fromTo('#${id}-A', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    // 1) i comandi in testa
    view(1.6, 1.1, head.x, head.y, 2.0);
    // 2) mini-mese e link agli arretrati
    view(7.0, 1.0, mese.x, (mese.y + arr.y) / 2 + 40, 2.25);
    // 3) gli operatori; il clic su «Tutti» fa comparire le colonne dei colleghi
    view(12.0, 1.0, op.x, op.y - 20, 2.25);
    curAt(tutti.x + 120, tutti.y + 80);
    curShow(13.6, true);
    curTo(13.7, 1.0, { x: tutti.x, y: tutti.y });
    tap(14.9);
    tl.to('#${id}-A', { opacity: 0, duration: 0.25 }, 14.95);
    tl.to('#${id}-B', { opacity: 1, duration: 0.25 }, 14.95);
    curShow(15.3, false);
    view(15.5, 1.0, calB.x - 70, calB.y - 40, 1.75);
    // 4) di nuovo sul pannello: il numero rosso accanto a «Senza assegnatario»
    view(18.0, 1.0, op.x, op.y - 20, 2.25);
    ${c.js}
  `;
  const sfx = [{ t: 14.9, f: 'interface/click_003.ogg', v: 0.5 }, { t: 15.0, f: 'interface/drop_002.ogg', v: 0.35 }];
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx };
}
