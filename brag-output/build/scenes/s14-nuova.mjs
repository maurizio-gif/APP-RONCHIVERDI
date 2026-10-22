import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { scheda, rigaRichiamo, fattaLi } from '../ui.mjs';

// Capitolo 4 — «Nuova azione»: fissare subito il prossimo passo (visita in sede).
export default async function () {
  const id = 's14';
  const dur = 24;
  const lista = [
    { t: 0.8, d: 4.7, h: 'Subito il prossimo passo: se resta solo in testa a te, <b>si perde</b>.' },
    { t: 6.0, d: 4.4, h: 'Tipo, giorno, ora, a chi e cosa c’è da fare.' },
    { t: 13.7, d: 3.7, h: 'Compare in <b>In programma</b>, e nel calendario.' },
    { t: 18.0, d: 4.8, h: 'Email e WhatsApp si <b>registrano soltanto</b>: li annoti dopo averli mandati.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-pg { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; }
    #${id}-ddl { position: absolute; width: 190px; padding: 4px; background: #fdfaf3; border: 1px solid rgba(28,28,24,.3); border-radius: 6px;
      box-shadow: 0 10px 24px rgba(28,28,24,.22); font-size: 15px; opacity: 0; z-index: 50; }
    #${id}-ddl div { padding: 5px 10px; border-radius: 4px; }
    #${id}-ddl div.on { background: rgba(139,108,20,.16); font-weight: 600; }
  `;
  const nuovaRiga = rigaRichiamo({
    id: id + 'x', tipo: 'sede', quando: 'sab 24 ott · 15:00', fascia: false, noBtn: 'Non si è presentato',
    dett: 'Tour in sede e proposta abbonamento',
  });
  const html = scheda({
    id: id + 's', conLead: false,
    ora: '', oraConto: 0,
    prog: nuovaRiga.replace('<li ', '<li style="opacity:0" '), progConto: 0,
    fatte: fattaLi({ nota: 'Vuole il tour sabato pomeriggio' }), fatteConto: 1,
    tipoNuova: 'Telefonata', giornoNuova: 'gio 22 ott', oraNuova: '', chiNuova: 'Io',
    notaNuova: ['Tour in sede e proposta abbonamento'], btnNuova: 'Aggiungi',
  }).replace(/<div class="page-head"[\s\S]*?<\/div>\s*<\/div>/, '');
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-pg">${html}</div>
        <div id="${id}-ddl"><div class="on">Visita in sede</div><div>Telefonata</div><div>Task</div><div>Email</div><div>WhatsApp</div></div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const prog = W('#${id}s-prog'), nuova = W('#${id}s-nuova'), tipo = W('#${id}s-tipo', 0.5, 1), tipoC = W('#${id}s-tipo'),
          giorno = W('#${id}s-giorno'), oraIn = W('#${id}s-ora-in'), nnota = W('#${id}s-nnota'), agg = W('#${id}s-agg');
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set(['#${id}s-giorno', '#${id}s-ora-in', '#${id}s-tipo', '#${id}s-agg'], { outline: '0px solid #17170f', outlineOffset: '3px' });
    viewSet(prog.x, nuova.y + 30, 1.9);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    // Tipo: si apre la tendina e si sceglie «Visita in sede»
    const dd = $('#${id}-ddl');
    gsap.set(dd, { x: tipoC.x - 70, y: tipo.y + 6 });
    curAt(tipoC.x + 200, tipoC.y + 90);
    curShow(5.7, true);
    curTo(5.8, 0.9, { x: tipoC.x + 10, y: tipoC.y + 2 });
    tap(6.9);
    tl.fromTo(dd, { opacity: 0, y: tipo.y - 2 }, { opacity: 1, y: tipo.y + 6, duration: 0.18 }, 6.95);
    curTo(7.2, 0.5, { x: tipoC.x - 40, y: tipo.y + 22 });
    tap(8.0);
    tl.to(dd, { opacity: 0, duration: 0.14 }, 8.1);
    tl.set('#${id}s-tipo option', { innerHTML: 'Visita in sede' }, 8.12);
    // giorno e ora
    tl.to('#${id}s-giorno-a', { opacity: 0, duration: 0.12 }, 8.7); tl.to('#${id}s-giorno-b', { opacity: 1, duration: 0.12 }, 8.7);
    tl.to('#${id}s-ora-a', { opacity: 0, duration: 0.12 }, 9.3); tl.to('#${id}s-ora-b', { opacity: 1, duration: 0.12 }, 9.3);
    tl.to('#${id}s-giorno', { outlineWidth: 3, duration: 0.2 }, 8.7); tl.to('#${id}s-giorno', { outlineWidth: 0, duration: 0.3 }, 9.2);
    tl.to('#${id}s-ora-in', { outlineWidth: 3, duration: 0.2 }, 9.3); tl.to('#${id}s-ora-in', { outlineWidth: 0, duration: 0.3 }, 9.8);
    // la nota si scrive
    curTo(9.4, 0.6, { x: nnota.x - 40, y: nnota.y + 3 });
    tap(10.1);
    tl.to('#${id}s-nph', { opacity: 0, duration: 0.1 }, 10.15);
    const fine = write(10.3, '#${id}s-nt0', 20);
    curTo(fine + 0.1, 0.7, { x: agg.x, y: agg.y });
    tap(fine + 0.95); press(fine + 0.95, '#${id}s-agg');
    // la riga compare in «In programma»
    const T = fine + 1.1;
    tl.fromTo('#${id}x', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, T);
    tl.set('#${id}s-prog-conto', { innerHTML: '1' }, T);
    tl.set('#${id}s-prog-vuoto', { display: 'none' }, T);
    curShow(T + 0.3, false);
    // Email e WhatsApp: il pulsante diventa «Registra»
    tl.set('#${id}s-tipo option', { innerHTML: 'Email' }, 18.3);
    tl.set('#${id}s-agg', { innerHTML: 'Registra' }, 18.3);
    tl.to('#${id}s-tipo', { outlineWidth: 3, duration: 0.2 }, 18.3); tl.to('#${id}s-tipo', { outlineWidth: 0, duration: 0.3 }, 20.8);
    tl.to('#${id}s-agg', { outlineWidth: 3, duration: 0.2 }, 18.4); tl.to('#${id}s-agg', { outlineWidth: 0, duration: 0.3 }, 21.0);
    ${c.js}
  `;
  const sfx = [
    { t: 6.9, f: 'interface/click_003.ogg', v: 0.5 }, { t: 8.0, f: 'interface/click_002.ogg', v: 0.5 }, { t: 10.1, f: 'interface/click_003.ogg', v: 0.5 },
    { t: 10.7, f: 'interface/click_005.ogg', v: 0.22 }, { t: 11.3, f: 'interface/click_002.ogg', v: 0.22 }, { t: 11.9, f: 'interface/click_005.ogg', v: 0.22 },
    { t: 13.2, f: 'interface/click_003.ogg', v: 0.55 }, { t: 13.75, f: 'interface/drop_001.ogg', v: 0.4 },
  ];
  return { id, dur, css, body, script, chapter: { n: '4', t: 'Lavorare un lead' }, sfx };
}
