import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { azioneRiga, chip, pageHead } from '../ui.mjs';

// Capitolo 3 — la vista elenco: stesso lavoro, filtri a chip, «Senza assegnatario», ricerca, «Aggiungi in agenda».
export default async function () {
  const id = 's11';
  const dur = 25;
  const lista = [
    { t: 1.0, d: 4.2, h: 'Stessa agenda, in elenco: <b>Arretrati, Oggi, Prossimi 30 giorni, Fatte</b>.' },
    { t: 5.6, d: 3.0, h: 'Fatte: gli <b>ultimi 14 giorni</b>.' },
    { t: 11.0, d: 3.8, h: '<b>Senza assegnatario</b>: i lead che non ha preso nessuno.' },
    { t: 15.2, d: 3.2, h: 'Cerca per <b>nome, cognome, telefono o email</b>.' },
    { t: 19.6, d: 4.4, h: 'Il pulsante <b>Aggiungi in agenda</b> inserisce una voce a mano.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-pg { left: 40px; top: 20px; width: 780px; padding: 22px 26px 18px; }
    #${id}-pg .page-head { margin-bottom: 0.9rem; }
    #${id}-pg .page-head h1 { font-size: 2rem; margin-bottom: 0; }
    #${id}-rows-b { position: absolute; left: 0; right: 0; top: 0; }
    #${id}-lista { position: relative; }
  `;
  const tutte = [
    azioneRiga({ tipo: 'sede', quando: '15:00', nome: 'Davide Sala', tel: '338 555 0177', chi: 'Elena B.', dett: 'Tour in sede' }),
    azioneRiga({ tipo: 'sede', quando: '16:00', nome: 'Laura Costa', tel: '349 555 0166', chi: 'Marco T.', dett: 'Tour in sede' }),
    azioneRiga({ tipo: 'telefono', quando: 'Sera 17–20', nome: 'Chiara Morandi', tel: '340 123 4567', chi: 'Elena B.', dett: 'Abbonamento Club e Family' }),
    azioneRiga({ tipo: 'telefono', quando: 'Sera 17–20', nome: 'Franco Gatti', tel: '335 555 0111', chi: 'nessuno', dett: 'Abbonamento Club e Family' }),
    azioneRiga({ tipo: 'sede', quando: '17:30', nome: 'Anna Greco', tel: '349 555 0140', chi: 'Elena B.', dett: 'Tour in sede' }),
  ].join('');
  const senza = [
    azioneRiga({ tipo: 'telefono', quando: 'Sera 17–20', nome: 'Franco Gatti', tel: '335 555 0111', chi: 'nessuno', dett: 'Abbonamento Club e Family' }),
    azioneRiga({ tipo: 'messaggio', quando: 'oggi', nome: 'Irene Lodi', tel: '347 555 0190', chi: 'nessuno', dett: 'Vorrei informazioni sull’abbonamento Family' }),
  ].join('');
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-pg">
          ${pageHead('Segreteria', 'Agenda · vista elenco')}
          <div class="agenda-nuova"><button type="button" class="btn" id="${id}-nuova">Aggiungi in agenda</button></div>
          <section class="riepilogo-sezione">
            <div class="filtro-gruppo" id="${id}-chips">
              ${chip('Arretrati', 3)}${chip('Oggi', 5, { attivo: true })}${chip('Prossimi 30 giorni', 12)}${chip('Fatte', 18)}
              <span class="filtro-separatore" aria-hidden="true"></span>
              ${chip('Di tutti', null, { attivo: true, id: id + '-ditutti' })}${chip('Le mie', null)}${chip('Senza assegnatario', null, { id: id + '-senza' })}
            </div>
            <form class="agenda-cerca" id="${id}-cerca"><input type="search" placeholder="Nome, cognome, telefono, email" /><button class="btn btn-ghost btn-sm" type="button">Cerca</button></form>
            <div class="card" id="${id}-card">
              <div id="${id}-lista">
                <ul class="azioni-elenco" id="${id}-A">${tutte}</ul>
                <ul class="azioni-elenco" id="${id}-B" style="position:absolute;left:0;right:0;top:0;opacity:0">${senza}</ul>
              </div>
            </div>
          </section>
        </div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const chips = W('#${id}-chips'), card = W('#${id}-card'), senza = W('#${id}-senza', 0.5, 0.5), cerca = W('#${id}-cerca', 0.25, 0.5), nuova = W('#${id}-nuova');
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set(['#${id}-cerca', '#${id}-nuova'], { outline: '0px solid #17170f', outlineOffset: '3px' });
    viewSet(chips.x, chips.y - 30, 2.2);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    // il cursore va su «Senza assegnatario»: la lista si restringe
    curAt(senza.x + 160, senza.y + 130);
    curShow(8.6, true);
    curTo(8.7, 1.2, { x: senza.x + 6, y: senza.y + 3 });
    tap(10.2);
    tl.set('#${id}-senza', { className: 'chip is-attivo', innerHTML: '<span class="chip-spunta" aria-hidden="true">✓</span>Senza assegnatario' }, 10.25);
    tl.set('#${id}-ditutti', { className: 'chip', innerHTML: 'Di tutti' }, 10.25);
    tl.to('#${id}-A', { opacity: 0, duration: 0.25 }, 10.25);
    tl.to('#${id}-B', { opacity: 1, duration: 0.3 }, 10.4);
    curShow(10.9, false);
    view(10.6, 1.0, card.x, card.y - 40, 2.2);
    // la ricerca
    view(14.4, 1.0, cerca.x + 120, cerca.y + 40, 2.2);
    tl.to('#${id}-cerca', { outlineWidth: 4, duration: 0.25 }, 15.4);
    tl.to('#${id}-cerca', { outlineWidth: 0, duration: 0.3 }, 18.0);
    // e il pulsante in testa
    view(18.6, 1.0, nuova.x + 100, nuova.y + 40, 2.2);
    tl.to('#${id}-nuova', { outlineWidth: 4, duration: 0.25 }, 19.7);
    tl.to('#${id}-nuova', { outlineWidth: 0, duration: 0.3 }, 24.0);
    ${c.js}
  `;
  const sfx = [{ t: 10.2, f: 'interface/click_003.ogg', v: 0.5 }, { t: 10.45, f: 'interface/drop_002.ogg', v: 0.35 }];
  return { id, dur, css, body, script, chapter: { n: '3', t: 'L’Agenda' }, sfx };
}
