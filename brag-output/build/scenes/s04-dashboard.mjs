import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { leadTesto, comandiLead, chip, azioneRiga, pageHead } from '../ui.mjs';

// Capitolo 2, seconda metà — la Dashboard New: lead da prendere, «In carico a», le azioni.
export default async function () {
  const id = 's04';
  const dur = 19;
  const lista = [
    { t: 0.8, d: 3.9, h: 'Nella Dashboard New trovi i lead <b>da prendere in carico</b>.' },
    { t: 5.0, d: 3.7, h: 'Scegli <b>«Io»</b> in «In carico a»: il lead è tuo.' },
    { t: 9.7, d: 4.2, h: 'Sotto, le tue azioni: <b>arretrate</b>, di oggi, dei prossimi 14 giorni.' },
    { t: 14.1, d: 4.4, h: 'Prendere in carico è dei commerciali. Chi coordina <b>vede, ma non prende</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-pg { left: 40px; top: 24px; width: 760px; padding: 22px 26px 18px; }
    #${id}-pg .page-head { margin-bottom: 1rem; }
    #${id}-pg .page-head h1 { font-size: 2rem; margin-bottom: 0; }
    #${id}-pg .agenda-cerca { margin-bottom: 14px; }
    #${id}-pg .riepilogo-sezione { margin-bottom: 18px; }
    #${id}-pg .lead-riga { padding-top: 10px; padding-bottom: 10px; }
    #${id}-ddl { position: absolute; width: 130px; padding: 4px; background: #fdfaf3; border: 1px solid rgba(28,28,24,.3); border-radius: 6px;
      box-shadow: 0 10px 24px rgba(28,28,24,.22); font-size: 15px; opacity: 0; z-index: 50; }
    #${id}-ddl div { padding: 5px 10px; border-radius: 4px; }
    #${id}-ddl div.on { background: rgba(139,108,20,.16); font-weight: 600; }
  `;
  const righe = [
    { nome: 'Chiara Morandi', prov: 'sito', rich: 'richiamami', tipo: 'telefono', attesa: 'aperta oggi', cls: 'attesa-oggi' },
    { nome: 'Luca Ferri', prov: 'banco', rich: 'in_sede', attesa: 'aperta da ieri', cls: 'attesa-recente' },
  ];
  const lead = righe
    .map(
      (r, i) => `
        <li class="lead-riga riga-stato stato-nuovo">
          ${leadTesto({ nome: r.nome, prov: r.prov, rich: r.rich, tipo: r.tipo, attesa: r.attesa, attesaCls: r.cls })}
          ${comandiLead({ idIn: i === 0 ? id + '-sel' : '', idSt: i === 0 ? id + '-st' : '' })}
          <a class="btn btn-ghost btn-sm">Apri scheda ↗</a>
        </li>`
    )
    .join('');
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-pg">
          ${pageHead('CRM Ronchiverdi', 'Ciao Elena')}
          <section class="riepilogo-sezione" id="${id}-lead">
            <div class="riepilogo-testa"><h2 class="riepilogo-titolo">Lead</h2><span class="badge badge-warn badge-punto">3 da prendere in carico</span></div>
            <div class="filtro-gruppo">
              ${chip('Da prendere in carico', 3, { attivo: true })}${chip('Assegnate a te', 1)}${chip('In gestione', 4)}${chip('Vinte', 2)}${chip('Perse', 1)}
            </div>
            <div class="card"><ul class="lead-elenco">${lead}</ul></div>
          </section>
          <section class="riepilogo-sezione" id="${id}-azioni">
            <div class="riepilogo-testa"><h2 class="riepilogo-titolo">Azioni</h2><span class="badge badge-ko badge-punto">2 arretrati</span></div>
            <div class="filtro-gruppo">
              ${chip('Arretrati', 2)}${chip('Oggi', 5, { attivo: true })}${chip('Prossimi 14 giorni', 8)}<span class="filtro-separatore" aria-hidden="true"></span>${chip('Di tutti', null, { attivo: true })}${chip('Le mie', null)}
            </div>
            <div class="card"><ul class="azioni-elenco">
              ${azioneRiga({ tipo: 'sede', quando: '10:30', nome: 'Giulia Rinaldi', tel: '347 555 0102', chi: 'Marco T.', dett: 'Abbonamento Club e Family' })}
              ${azioneRiga({ tipo: 'telefono', quando: '15:00', nome: 'Davide Sala', tel: '338 555 0177', chi: 'Elena B.', dett: 'Richiamare per confermare l’iscrizione' })}
            </ul></div>
          </section>
          <div id="${id}-ddl"><div>Nessuno</div><div class="on">Io</div><div>Marco T.</div><div>Sofia L.</div></div>
        </div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const pg = W('#${id}-pg'), lead = W('#${id}-lead'), azi = W('#${id}-azioni');
    const sel = W('#${id}-sel'), selTop = W('#${id}-sel', 0.1, 1);
    const dd = $('#${id}-ddl');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(lead.x, lead.y - 6, 1.85);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    // Il menu a tendina di «In carico a» (disegnato, perché una <select> aperta non si fotografa).
    gsap.set(dd, { x: selTop.x - 4, y: selTop.y + 4, transformOrigin: '0 0' });
    curAt(sel.x + 200, sel.y + 120);
    curShow(4.3, true);
    curTo(4.4, 1.0, { x: sel.x + 14, y: sel.y + 3 });
    tap(5.5);
    tl.fromTo(dd, { opacity: 0, y: selTop.y - 2 }, { opacity: 1, y: selTop.y + 4, duration: 0.18, ease: 'power2.out' }, 5.56);
    curTo(6.0, 0.5, { x: sel.x + 10, y: selTop.y + 4 + 40 });
    tap(6.8);
    tl.to(dd, { opacity: 0, duration: 0.14 }, 6.9);
    tl.set('#${id}-sel option', { innerHTML: 'Io' }, 6.95);
    tl.fromTo('#${id}-sel', { backgroundColor: 'rgba(200,153,31,0.0)' }, { backgroundColor: 'rgba(200,153,31,0.22)', duration: 0.25 }, 6.95);
    tl.to('#${id}-sel', { backgroundColor: 'rgba(200,153,31,0.0)', duration: 0.8 }, 7.5);
    curShow(8.0, false);
    // Un passo giù: la sezione Azioni.
    view(9.0, 1.0, azi.x, azi.y - 10, 1.95);
    ${c.js}
  `;
  const sfx = [
    { t: 5.5, f: 'interface/click_003.ogg', v: 0.5 },
    { t: 6.8, f: 'interface/click_002.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, chapter: { n: '2', t: 'Prendere in carico' }, sfx };
}
