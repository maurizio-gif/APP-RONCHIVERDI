import { runtime, caps, CURSOR_SVG, typed } from '../lib.mjs';
import { pageHead } from '../ui.mjs';

// Passo 4: Chiron verifica e usa il codice (app/dashboard/validazione/Validatore.tsx).
export default async function () {
  const id = 's05';
  const dur = 22;
  const lista = [
    { t: 0.9, d: 4.2, h: 'Chiron entra nel CRM <b>con le sue credenziali</b>.' },
    { t: 5.6, d: 4.6, h: 'Inserisce il codice: la pagina dice se è <b>ancora utilizzabile</b>.' },
    { t: 10.6, d: 5.4, h: 'Controlla il nominativo, poi <b>conferma</b>.' },
    { t: 17.0, d: 4.4, h: 'Il codice si consuma: <b>non è più utilizzabile</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-form { left: 120px; top: 40px; width: 700px; padding: 28px 32px 30px; }
    #${id}-res { left: 880px; top: 40px; width: 760px; height: 560px; padding: 28px 32px; }
    #${id}-form .field label { font-size: 28px; }
    #${id}-form .field-hint { font-size: 28px !important; }
    #${id}-in { border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); padding: 12px 16px; font-size: 40px; letter-spacing: .12em; height: 70px; font-variant-numeric: tabular-nums; }
    #${id}-form .btn-block { font-size: 28px; padding: .8rem; }
    #${id}-r1, #${id}-r2 { position: absolute; left: 32px; right: 32px; top: 28px; }
    #${id}-res .muted, #${id}-res p { font-size: 28px; }
    #${id}-res h2 { font-size: 60px; }
    #${id}-res .btn-block { font-size: 28px; padding: .8rem; }
    #${id}-r2 { opacity: 0; }
    #${id}-r2 .ok-banner { font-size: 30px; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-form">
          ${pageHead('Visita medico-sportiva', 'Validazione voucher')}
          <div class="field" style="margin-top:1rem">
            <label>Codice del voucher</label>
            <div id="${id}-in">${typed('1234 5678')}</div>
            <p class="field-hint" >Le cifre che ti detta il socio: spazi e trattini non contano.</p>
          </div>
          <button type="button" class="btn btn-block" id="${id}-ver">Verifica codice</button>
        </div>
        <div class="frag" id="${id}-res">
          <div id="${id}-r1" style="opacity:0">
            <div class="card-head"><h2 style="margin:0">1234 5678</h2><span class="badge badge-ok" style="font-size:28px">Attivo</span></div>
            <p class="muted">Intestato a <strong>Mario Rossi</strong> · valido fino al 29/10/2027</p>
            <p class="muted" style="margin-top:.75rem">Controlla il nominativo con chi è al telefono, poi conferma: il codice si consuma subito e non è più riutilizzabile.</p>
            <button type="button" class="btn btn-block" style="margin-top:.75rem" id="${id}-conf">Conferma la prenotazione e usa il codice</button>
          </div>
          <div id="${id}-r2">
            <p class="ok-banner">Codice 12345678 registrato come utilizzato.</p>
            <p class="muted">Intestato a <strong>Mario Rossi</strong> · 29/10/2026, 11:05<br>Il socio ha ricevuto ora la notifica di utilizzo.</p>
          </div>
        </div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const fm = W('#${id}-form'), rs = W('#${id}-res'), vb = W('#${id}-ver'), cb = W('#${id}-conf');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(fm.x + 380, fm.y, 1.0);
    tl.fromTo('#${id}-form', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    tl.fromTo('#${id}-res', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.4);
    // Il codice viene scritto.
    write(6.0, '#${id}-in', 6);
    // «Verifica codice».
    curAt(vb.x + 300, vb.y + 140);
    curShow(8.0, true);
    curTo(8.1, 1.0, { x: vb.x, y: vb.y });
    press(9.2, '#${id}-ver'); tap(9.2);
    tl.fromTo('#${id}-r1', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 9.5);
    // «Conferma».
    curTo(12.4, 2.0, { x: cb.x, y: cb.y });
    press(16.2, '#${id}-conf'); tap(16.2);
    tl.to('#${id}-r1', { opacity: 0, duration: 0.2 }, 16.5);
    tl.to('#${id}-r2', { opacity: 1, duration: 0.4 }, 16.7);
    curShow(16.9, false);
    ${c.js}
  `;
  const sfx = [
    { t: 0.5, f: 'interface/bong_001.ogg', v: 0.5 },
    { t: 9.2, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 16.2, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 16.7, f: 'impact/impactSoft_medium_004.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, chapter: { n: '4', t: 'Chiron usa il codice' }, sfx };
}
