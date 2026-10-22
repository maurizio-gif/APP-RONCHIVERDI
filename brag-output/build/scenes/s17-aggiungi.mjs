import { runtime, caps, CURSOR_SVG } from '../lib.mjs';

// Capitolo 6 — «Aggiungi in agenda»: Programma / Registra, nuovo contatto, e l'evento che apre il lead.
export default async function () {
  const id = 's17';
  const dur = 23.6;
  const lista = [
    { t: 0.8, d: 4.2, h: '<b>Programma</b>: un impegno da tenere, in agenda finché non lo chiudi.' },
    { t: 5.1, d: 4.5, h: '<b>Registra</b>: qualcosa che hai già fatto, già chiuso con la sua nota.' },
    { t: 9.7, d: 3.6, h: 'Il contatto non c’è? <b>Nuovo contatto</b>: basta il nome.' },
    { t: 13.4, d: 4.5, h: 'Se esiste già — stessa email o stesso numero — <b>niente doppioni</b>.' },
    { t: 18.0, d: 5.0, h: 'Un evento scritto su una persona <b>apre il suo lead</b>: in gestione a te.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-pg { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; }
    #${id}-pg .card { margin-bottom: 0; }
  `;
  const modo = (id2, on1) => `<div class="modo-evento" id="${id2}">
          <div class="esito-gruppi"><button type="button" class="btn btn-sm${on1 ? '' : ' btn-ghost'}" id="${id2}-p">Programma</button><button type="button" class="btn btn-sm${on1 ? ' btn-ghost' : ''}" id="${id2}-r">Registra</button></div>
          <p class="field-hint" id="${id2}-hint">Un impegno da tenere: nasce da fare, e resta in agenda finché non lo chiudi.</p>
        </div>`;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-pg">
          <p class="info-banner" role="status" id="${id}-banner" style="display:none;margin-bottom:1rem">Aperta anche la trattativa di questo contatto, in gestione a te. <button type="button" class="btn btn-ghost btn-sm">Ho capito</button></p>
          <div id="${id}-btnw" style="display:none"><button type="button" class="btn">Aggiungi in agenda</button></div>
          <div class="card" id="${id}-card">
            <div class="card-head"><h2>Nuova voce</h2><button type="button" class="btn btn-ghost btn-sm">Chiudi</button></div>
            ${modo(id + 'm', true)}
            <div class="modo-evento" id="${id}-cont">
              <div class="esito-gruppi"><button type="button" class="btn btn-sm" id="${id}-dall">Dall’elenco</button><button type="button" class="btn btn-sm btn-ghost" id="${id}-nuovo">Nuovo contatto</button></div>
              <p class="field-hint" id="${id}-conthint">Il contatto a cui agganciare la voce. Se non è in elenco, creane uno nuovo.</p>
            </div>
            <div class="form-row" id="${id}-fields" style="opacity:0">
              <div class="field"><label>Nome <span aria-hidden="true">*</span></label><div class="azione-nota" style="width:100%;height:2.2em;position:relative;overflow:hidden;white-space:nowrap;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)"><span id="${id}-nome" style="position:absolute;left:0.55rem;top:0.4rem">${[...'Marco Bianchi'].map((ch) => `<span style="opacity:0">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</span></div></div>
              <div class="field"><label>Cognome</label><div class="azione-nota" style="width:100%;height:2.2em;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)"></div></div>
              <div class="field"><label>Email</label><div class="azione-nota" style="width:100%;height:2.2em;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)"></div></div>
              <div class="field"><label>Cellulare</label><div class="azione-nota" style="width:100%;height:2.2em;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)"></div>
                <p class="field-hint">Facoltativi. Ma se ne lasci uno lo ritroviamo quando torna: senza, una sua richiesta dal sito creerà un secondo contatto da unire a mano.</p></div>
            </div>
          </div>
        </div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const mp = W('#${id}m'), r = W('#${id}m-r'), nuovo = W('#${id}-nuovo'), fields = W('#${id}-fields', 0.5, 0.2), cont = W('#${id}-cont'),
          card = W('#${id}-card', 0.5, 0.0), nome = W('#${id}-nome');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(mp.x + 40, mp.y + 70, 2.0);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    // Programma → Registra (cambia la spiegazione)
    curAt(r.x + 150, r.y + 90);
    curShow(4.8, true);
    curTo(4.9, 0.7, { x: r.x, y: r.y });
    tap(5.7); press(5.7, '#${id}m-r');
    tl.set('#${id}m-p', { className: 'btn btn-sm btn-ghost' }, 5.75);
    tl.set('#${id}m-r', { className: 'btn btn-sm' }, 5.75);
    tl.set('#${id}m-hint', { innerHTML: 'Qualcosa che hai già fatto: nasce chiusa, con l’esito e la nota di com’è andata.' }, 5.75);
    // Nuovo contatto: compaiono i campi
    view(8.8, 0.9, cont.x + 20, cont.y + 120, 1.85);
    curTo(9.4, 0.8, { x: nuovo.x, y: nuovo.y });
    tap(10.3); press(10.3, '#${id}-nuovo');
    tl.set('#${id}-dall', { className: 'btn btn-sm btn-ghost' }, 10.35);
    tl.set('#${id}-nuovo', { className: 'btn btn-sm' }, 10.35);
    tl.set('#${id}-conthint', { innerHTML: 'Basta il nome: entra in anagrafica adesso, segnato come inserito a mano. Se ci fosse già — stessa email o stesso numero — la voce va sulla scheda che c’è, senza doppioni.' }, 10.35);
    tl.to('#${id}-fields', { opacity: 1, duration: 0.4 }, 10.6);
    write(11.4, '#${id}-nome', 12);
    curShow(12.8, false);
    // il banner finale
    view(17.0, 1.0, card.x, card.y - 70, 2.0);
    tl.to('#${id}-card', { opacity: 0, duration: 0.25 }, 17.3);
    tl.set('#${id}-card', { display: 'none' }, 17.6);
    tl.set(['#${id}-banner', '#${id}-btnw'], { display: 'flex' }, 17.6);
    tl.fromTo(['#${id}-banner', '#${id}-btnw'], { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.12 }, 17.65);
    ${c.js}
  `;
  const sfx = [{ t: 5.7, f: 'interface/click_003.ogg', v: 0.5 }, { t: 10.3, f: 'interface/click_002.ogg', v: 0.5 }, { t: 17.7, f: 'interface/bong_001.ogg', v: 0.45 }];
  return { id, dur, css, body, script, chapter: { n: '6', t: 'Il lead non arriva da solo' }, sfx };
}
