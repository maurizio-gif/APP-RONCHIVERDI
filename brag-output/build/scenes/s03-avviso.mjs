import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { avviso, azioneRiga, trattativa, pageHead } from '../ui.mjs';

// Capitolo 2, prima metà — l'avviso e «Prendi in carico».
export default async function () {
  const id = 's03';
  const dur = 22.4;
  const lista = [
    { t: 0.9, d: 4.2, h: 'Un nuovo lead? Te lo dice <b>un avviso</b>, su qualunque pagina.' },
    { t: 4.9, d: 5.7, h: 'Nome, recapiti e la <b>frase che ha scritto</b>: è da lì che si apre la telefonata.' },
    { t: 10.7, d: 3.3, h: 'Non blocca la pagina: <b>finisci pure la telefonata</b>.' },
    { t: 14.9, d: 4.2, h: '«Prendi in carico»: il lead è tuo e passa <b>In gestione</b>.' },
    { t: 19.3, d: 2.4, h: 'Poi ti porta in <b>Agenda</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-win { left: 40px; top: 30px; width: 900px; height: 560px; padding: 26px 30px; }
    #${id}-win .page-head { margin-bottom: 1rem; }
    #${id}-win .azioni-elenco { margin-top: 4px; }
    #${id}-blk { left: 0; top: 0; width: 470px; padding: 14px; opacity: 0; }
    #${id}-blk .trattativa { margin: 0; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-win">
          ${pageHead('Segreteria', 'Agenda · vista elenco')}
          <div class="card">
            <ul class="azioni-elenco">
              ${azioneRiga({ tipo: 'sede', quando: '10:30', nome: 'Giulia Rinaldi', tel: '347 555 0102', chi: 'Marco T.', dett: 'Abbonamento Club e Family' })}
              ${azioneRiga({ tipo: 'telefono', quando: '15:00', nome: 'Davide Sala', tel: '338 555 0177', chi: 'Elena B.', dett: 'Richiamare per confermare l’iscrizione' })}
              ${azioneRiga({ tipo: 'sede', quando: '17:30', nome: 'Anna Greco', tel: '349 555 0140', chi: 'Sofia L.', dett: 'Tour in sede' })}
            </ul>
          </div>
          ${avviso({ id: id + '-av', nome: 'Chiara Morandi', sezione: 'Eventi Core', recapiti: 'Abbonamento Club e Family · chiara.morandi@example.it · 340 123 4567', messaggio: 'Vorrei provare il club e capire quali abbonamenti ci sono.' })}
        </div>
        <div class="frag" id="${id}-blk">${trattativa({ id: id + '-t', stato: 'nuovo', azione: 'nessuno la segue: prendila in carico' })}</div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    // Prima si misura (le entrate spostano gli elementi), poi si anima.
    const win = W('#${id}-win'), av = W('#${id}-av'), pb = W('#${id}-av-prendi');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(win.x, win.y + 8, 1.2);
    tl.fromTo('#${id}-win', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    // L'avviso entra dal basso, com'è nell'app.
    tl.fromTo('#${id}-av', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 1.5);
    // La camera si avvicina all'avviso.
    view(4.2, 1.0, av.x, av.y + 4, 2.0);
    // Il blocco trattativa va dove sta l'avviso.
    gsap.set('#${id}-blk', { x: av.x - 235, y: av.y - 110 });
    // Il cursore va su «Prendi in carico».
    curAt(av.x + 120, av.y + 190);
    curShow(11.9, true);
    curTo(12.0, 1.6, { x: pb.x, y: pb.y });
    press(13.75, '#${id}-av-prendi');
    tap(13.75);
    // L'avviso si chiude; compare il blocco della trattativa, che cambia stato.
    tl.to('#${id}-av', { opacity: 0, y: 14, duration: 0.3, ease: 'power2.in' }, 14.05);
    curShow(14.0, false);
    tl.fromTo('#${id}-blk', { opacity: 0, y: av.y - 100 }, { opacity: 1, y: av.y - 110, duration: 0.5, ease: 'power3.out' }, 14.2);
    // Dopo un secondo di «Da prendere in carico», passa a «In gestione».
    const T = 15.7;
    tl.to('#${id}-t', { backgroundColor: 'rgba(53,86,107,0.08)', duration: 0.4 }, T);
    tl.to('#${id}-t-badge', { opacity: 0, duration: 0.12 }, T);
    tl.set('#${id}-t-badge', { innerHTML: 'In gestione', className: 'badge badge-stato badge-punto badge-info' }, T + 0.12);
    tl.to('#${id}-t-badge', { opacity: 1, duration: 0.2 }, T + 0.13);
    tl.set('#${id}-t-chi', { innerHTML: 'la segui tu' }, T + 0.12);
    tl.set('#${id}-t-az', { innerHTML: 'in corso: continua il seguito' }, T + 0.12);
    tl.to('#${id}-t-prendi', { opacity: 0, duration: 0.2 }, T);
    ${c.js}
  `;
  const sfx = [
    { t: 1.6, f: 'interface/bong_001.ogg', v: 0.55 },
    { t: 13.75, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 15.72, f: 'impact/impactSoft_medium_003.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, chapter: { n: '2', t: 'Prendere in carico' }, sfx };
}
