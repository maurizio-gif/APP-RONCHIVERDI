import { runtime, caps, CURSOR_SVG, typed } from '../lib.mjs';
import { pageHead } from '../ui.mjs';

// Il socio senza email: «Manca email» in evidenza e il campo «Salva e invia» (app/dashboard/voucher/AzioniVoucher.tsx).
export default async function () {
  const id = 's04b';
  const dur = 22;
  const lista = [
    { t: 0.9, d: 4.4, h: 'Socio senza email? Il voucher <b>viene creato lo stesso</b>.' },
    { t: 5.7, d: 5.0, h: 'Lo trovi in evidenza: avviso sopra l’elenco e <b>«Manca email»</b>.' },
    { t: 11.0, d: 5.0, h: 'Scrivi l’indirizzo e premi <b>«Salva e invia»</b>: il codice parte subito.' },
    { t: 16.6, d: 4.6, h: 'Oppure aggiungila in Info4U entro 7 giorni: <b>parte da sola</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-win { left: 120px; top: 30px; width: 1700px; padding: 28px 34px 30px; }
    #${id}-win table.tabella { font-size: 28px; }
    #${id}-win .cella-chi-nome { font-size: 30px; }
    #${id}-win .cella-chi-dettagli, #${id}-win .stat-label, #${id}-win .badge, #${id}-win th { font-size: 28px; }
    #${id}-win .btn-sm { font-size: 28px; }
    #${id}-win .warn-banner { font-size: 28px; }
    #${id}-win input { font-size: 28px; min-width: 0; width: 470px; height: 56px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); }
    #${id}-in { display: inline-block; width: 470px; height: 56px; padding: 8px 14px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); font-size: 28px; white-space: nowrap; overflow: hidden; vertical-align: middle; text-align: left; }
    #${id}-in .ph { color: #3d3d33; }
    #${id}-banner { transform-origin: 50% 0; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-win">
          ${pageHead('Partnership', 'Voucher visita medica')}
          <p class="warn-banner" id="${id}-banner"><strong>1 socio senza email</strong>: il voucher è pronto ma il codice non è partito. Inserisci l’indirizzo nella riga del socio e premi «Salva e invia».</p>
          <div class="card"><div class="tabella-wrap">
            <table class="tabella" id="${id}-tab">
              <thead><tr><th>Socio</th><th>Stato</th><th>Email</th><th></th></tr></thead>
              <tbody>
                <tr id="${id}-r1">
                  <td><div class="cella-chi-nome">Anna Neri</div><div class="cella-chi-dettagli">339 555 0188</div></td>
                  <td class="cella-nowrap"><span class="badge badge-ok">Attivo</span><div id="${id}-mk"><span class="badge badge-ko">Manca email</span></div></td>
                  <td class="cella-nowrap" style="position:relative;min-width:260px"><span class="muted" id="${id}-ni" style="position:absolute;left:0;top:0">non inviata</span><ul class="email-voucher" id="${id}-esito" style="opacity:0"><li><span class="badge badge-info">Consegnata</span> <a>codice assegnato</a><div class="cella-chi-dettagli">29/10/2026, 11:20</div></li></ul></td>
                  <td><div class="voucher-email-form" id="${id}-form"><span id="${id}-in"><span class="ph" id="${id}-ph">Email del socio</span><span id="${id}-tx">${typed('anna.neri@example.it')}</span></span><button type="button" class="btn btn-sm" id="${id}-salva">Salva e invia</button></div></td>
                </tr>
                <tr>
                  <td><div class="cella-chi-nome">Mario Rossi</div><div class="cella-chi-dettagli">mario.rossi@example.it</div></td>
                  <td class="cella-nowrap"><span class="badge badge-ok">Attivo</span></td>
                  <td class="cella-nowrap"><ul class="email-voucher"><li><span class="badge badge-ok">Aperta</span> <a>codice assegnato</a><div class="cella-chi-dettagli">29/10/2026, 10:20</div></li></ul></td>
                  <td><button type="button" class="btn btn-ghost btn-sm">Reinvia email</button></td>
                </tr>
              </tbody>
            </table>
          </div></div>
        </div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const win = W('#${id}-win'), ban = W('#${id}-banner'), mk = W('#${id}-mk'), inp = W('#${id}-in'), sb = W('#${id}-salva');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(win.x, win.y - 20, 1.0);
    tl.fromTo('#${id}-win', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    // L'avviso e la targhetta.
    tl.fromTo('#${id}-banner', { backgroundColor: 'rgba(138,100,16,0.12)' }, { backgroundColor: 'rgba(138,100,16,0.34)', duration: 0.4, yoyo: true, repeat: 1 }, 6.0);
    view(6.2, 1.2, ban.x, ban.y + 120, 1.1);
    tl.fromTo('#${id}-mk', { scale: 1 }, { scale: 1.15, duration: 0.3, yoyo: true, repeat: 1, transformOrigin: '0% 50%' }, 8.2);
    // Si scrive l'indirizzo.
    view(10.4, 1.0, inp.x - 330, inp.y, 1.15);
    tl.to('#${id}-ph', { opacity: 0, duration: 0.15 }, 11.6);
    write(11.8, '#${id}-tx', 11);
    // «Salva e invia».
    curAt(sb.x + 200, sb.y + 140);
    curShow(13.6, true);
    curTo(13.7, 1.3, { x: sb.x, y: sb.y });
    press(15.1, '#${id}-salva'); tap(15.1);
    curShow(15.5, false);
    tl.to('#${id}-mk', { opacity: 0, duration: 0.25 }, 15.3);
    tl.to('#${id}-form', { opacity: 0, duration: 0.25 }, 15.3);
    tl.to('#${id}-ni', { opacity: 0, duration: 0.2 }, 15.3);
    tl.to('#${id}-esito', { opacity: 1, duration: 0.4 }, 15.5);
    tl.to('#${id}-banner', { opacity: 0, duration: 0.3 }, 15.6);
    view(16.4, 1.2, win.x, win.y, 1.0);
    ${c.js}
  `;
  const sfx = [
    { t: 0.5, f: 'interface/bong_001.ogg', v: 0.5 },
    { t: 6.0, f: 'impact/impactSoft_medium_002.ogg', v: 0.4 },
    { t: 15.1, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 15.5, f: 'impact/impactSoft_medium_003.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, chapter: { n: '3', t: 'Socio senza email' }, sfx };
}
