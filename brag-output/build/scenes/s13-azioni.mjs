import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { scheda, rigaRichiamo, fattaLi } from '../ui.mjs';

// Capitolo 4 — la telefonata: «Non risponde, riprovo», poi «Fatto ✓». Il caso più frequente, per intero.
export default async function () {
  const id = 's13';
  const dur = 28;
  const lista = [
    { t: 0.9, d: 4.3, h: 'Questa è la telefonata del lead: <b>Richiamami, fascia Sera 17–20</b>.' },
    { t: 5.6, d: 4.6, h: 'Non risponde? Registra il tentativo: <b>il lead resta da fare</b>.' },
    { t: 10.8, d: 3.6, h: 'La riga segna <b>1 tentativo</b>: richiami nella stessa fascia.' },
    { t: 16.0, d: 4.4, h: 'Risponde? Scrivi <b>com’è andata</b> e premi «Fatto ✓».' },
    { t: 21.6, d: 4.4, h: 'La telefonata passa in <b>Fatte</b>, con la tua nota.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-pg { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; }
    #${id}-later { position: absolute; left: 0; right: 0; top: 150px; display: flex; justify-content: center; opacity: 0; z-index: 800; }
    #${id}-later span { padding: 14px 40px; border-radius: 14px; background: #1c1c18; color: #f6efde; font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 500; font-size: 64px; }
  `;
  const html = scheda({
    id: id + 's',
    ora: rigaRichiamo({ id: id + 'r', note: ['Squilla a vuoto', 'Vuole il tour sabato pomeriggio'] }),
    oraConto: 1,
    fatte: fattaLi({ id: id + 'f', nota: 'Vuole il tour sabato pomeriggio' }).replace('<li ', '<li style="opacity:0" '),
    fatteConto: 0,
    nuova: false,
  });
  const body = `
      <div class="cam" id="${id}-cam"><div class="frag" id="${id}-pg">${html}</div><div class="cur" id="${id}-cur">${CURSOR_SVG}</div></div>
      <div id="${id}-later"><span>Più tardi…</span></div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const riga = W('#${id}r'), nota = W('#${id}r-nota'), nr = W('#${id}r-nr'), fatto = W('#${id}r-fatto'),
          gFatte = W('#${id}s-fatte');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(riga.x, riga.y + 40, 2.2);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    // 1° tentativo: si scrive «Squilla a vuoto» e si preme «Non risponde, riprovo»
    curAt(nota.x + 180, nota.y + 140);
    curShow(5.0, true);
    curTo(5.1, 0.9, { x: nota.x - 40, y: nota.y + 4 });
    tap(6.1);
    tl.to('#${id}r-nota-ph', { opacity: 0, duration: 0.1 }, 6.15);
    const fine1 = write(6.3, '#${id}r-nota-t0', 14);
    curTo(fine1 + 0.2, 0.9, { x: nr.x, y: nr.y });
    tap(fine1 + 1.25);
    press(fine1 + 1.25, '#${id}r-nr');
    tl.to('#${id}r-nota-t0', { opacity: 0, duration: 0.15 }, fine1 + 1.35);
    tl.to('#${id}r-nota-ph', { opacity: 1, duration: 0.15 }, fine1 + 1.4);
    tl.to('#${id}r-tent', { opacity: 1, duration: 0.3 }, fine1 + 1.45);
    // «Più tardi…»
    tl.fromTo('#${id}-later', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 }, 14.1);
    tl.to('#${id}-later', { opacity: 0, duration: 0.3 }, 15.5);
    curShow(15.2, false);
    // 2° tentativo: risponde
    curAt(nota.x + 180, nota.y + 140);
    curShow(16.2, true);
    curTo(16.3, 0.8, { x: nota.x - 40, y: nota.y + 4 });
    tap(17.2);
    tl.to('#${id}r-nota-ph', { opacity: 0, duration: 0.1 }, 17.25);
    const fine2 = write(17.4, '#${id}r-nota-t1', 20);
    curTo(fine2 + 0.2, 0.8, { x: fatto.x, y: fatto.y });
    tap(fine2 + 1.1);
    press(fine2 + 1.1, '#${id}r-fatto');
    // la riga si chiude e passa in «Fatte»
    const T = fine2 + 1.25;
    tl.to('#${id}r', { opacity: 0, duration: 0.3 }, T);
    tl.set('#${id}s-ora-conto', { innerHTML: '0' }, T + 0.3);
    tl.set('#${id}r', { display: 'none' }, T + 0.35);
    curShow(T + 0.2, false);
    view(T + 0.5, 1.1, gFatte.x, gFatte.y - 30, 2.1);
    tl.set('#${id}s-fatte-conto', { innerHTML: '1' }, T + 1.3);
    tl.set('#${id}s-fatte-vuoto', { display: 'none' }, T + 1.3);
    tl.fromTo('#${id}f', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, T + 1.3);
    ${c.js}
  `;
  // suoni: clic, tick sulla scrittura (rarefatti), drop quando la telefonata passa in Fatte
  const sfx = [
    { t: 6.1, f: 'interface/click_003.ogg', v: 0.5 },
    { t: 7.0, f: 'interface/click_005.ogg', v: 0.25 }, { t: 7.35, f: 'interface/click_002.ogg', v: 0.22 }, { t: 7.7, f: 'interface/click_005.ogg', v: 0.22 },
    { t: 9.7, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 17.2, f: 'interface/click_003.ogg', v: 0.5 },
    { t: 18.0, f: 'interface/click_005.ogg', v: 0.25 }, { t: 18.5, f: 'interface/click_002.ogg', v: 0.22 }, { t: 19.0, f: 'interface/click_005.ogg', v: 0.22 },
    { t: 20.6, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 21.6, f: 'interface/drop_001.ogg', v: 0.4 },
  ];
  return { id, dur, css, body, script, chapter: { n: '4', t: 'Lavorare un lead' }, sfx };
}
