import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { pageHead } from '../ui.mjs';

// Passo 3: l'elenco «Voucher visita medica» (stesso markup di app/dashboard/voucher/page.tsx).
export default async function () {
  const id = 's04';
  const dur = 20;
  const lista = [
    { t: 0.9, d: 4.2, h: 'In <b>Voucher visita medica</b> vedi tutti i codici emessi.' },
    { t: 5.4, d: 5.0, h: 'Per ognuno: <b>stato</b> e <b>email inviate</b>, con il loro esito.' },
    { t: 10.8, d: 4.4, h: 'Non l’ha ricevuta? <b>«Reinvia email»</b>: stesso codice, stessa email.' },
    { t: 15.4, d: 3.9, h: 'Il codice <b>non si vede</b>: lo riceve solo il socio.' },
  ];
  const c = caps(id, lista, dur);
  const riga = (rid, nome, mail, badge, stato2, emBadge, emTesto, emData, azione) => `
    <tr id="${rid}">
      <td><div class="cella-chi-nome">${nome}</div><div class="cella-chi-dettagli">${mail}</div></td>
      <td class="cella-nowrap"><span class="badge ${badge}" id="${rid}-st">${stato2[0]}</span>${stato2[1] ? `<div class="cella-chi-dettagli">${stato2[1]}</div>` : ''}</td>
      <td class="cella-nowrap">${emBadge ? `<ul class="email-voucher"><li><span class="badge ${emBadge[0]}" id="${rid}-em">${emBadge[1]}</span> <a>${emTesto}</a><div class="cella-chi-dettagli">${emData}</div></li></ul>` : ''}</td>
      <td>${azione}</td>
    </tr>`;
  const css = `
    #${id}-win { left: 120px; top: 30px; width: 1700px; padding: 28px 34px 30px; }
    #${id}-win .griglia-stat { margin-top: .5rem; }
    #${id}-win table.tabella { font-size: 28px; }
    #${id}-win .cella-chi-nome { font-size: 28px; }
    #${id}-win .cella-chi-dettagli, #${id}-win .stat-label, #${id}-win .badge { font-size: 28px; }
    #${id}-win .btn-sm { font-size: 28px; }
    #${id}-win th { font-size: 28px; }
    #${id}-ok { position: absolute; left: 0; top: 0; opacity: 0; background: #1c1c18; color: #f6efde; border-radius: 12px; padding: 12px 20px; font-size: 24px; font-weight: 500; white-space: nowrap; z-index: 800; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-win">
          ${pageHead('Partnership', 'Voucher visita medica')}
          <div class="griglia-stat" id="${id}-stat">
            <div class="stat"><span class="stat-valore">2</span><span class="stat-label">Attivi</span></div>
            <div class="stat"><span class="stat-valore">1</span><span class="stat-label">Utilizzati</span></div>
            <div class="stat"><span class="stat-valore">0</span><span class="stat-label">Scaduti</span></div>
            <div class="stat"><span class="stat-valore">0</span><span class="stat-label">Annullati</span></div>
          </div>
          <div class="card" style="margin-top:1rem"><div class="tabella-wrap">
            <table class="tabella" id="${id}-tab">
              <thead><tr><th>Socio</th><th>Stato</th><th>Email</th><th></th></tr></thead>
              <tbody>
                ${riga(id + '-r1', 'Mario Rossi', 'mario.rossi@example.it', 'badge-ok', ['Attivo'], ['badge-ok', 'Aperta'], 'codice assegnato', '29/10/2026, 10:20', '<button type="button" class="btn btn-ghost btn-sm">Reinvia email</button>')}
                ${riga(id + '-r2', 'Laura Bianchi', 'laura.bianchi@example.it', '', ['Utilizzato', '28/10/2026, 15:42'], ['badge-ok', 'Cliccata'], 'codice utilizzato', '28/10/2026, 15:42', '')}
                ${riga(id + '-r3', 'Paolo Verdi', 'paolo.verdi@example.it', 'badge-ok', ['Attivo'], ['badge-ko', 'Non partita'], 'codice assegnato', '29/10/2026, 10:35', '<button type="button" class="btn btn-ghost btn-sm" id="' + id + '-reinvia">Reinvia email</button>')}
              </tbody>
            </table>
          </div></div>
        </div>
        <div id="${id}-ok">✓ Email reinviata, stesso codice</div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const win = W('#${id}-win'), st = W('#${id}-stat'), tab = W('#${id}-tab'), rb = W('#${id}-reinvia'), em = W('#${id}-r1-em');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(win.x, win.y - 20, 1.0);
    tl.fromTo('#${id}-win', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    view(2.4, 1.2, tab.x, tab.y - 60, 1.15);
    // Gli esiti delle email.
    ['r1','r2','r3'].forEach(function (r, i) {
      tl.fromTo('#${id}-' + r + '-em', { scale: 1 }, { scale: 1.18, duration: 0.25, ease: 'power2.out', yoyo: true, repeat: 1, transformOrigin: '0% 50%' }, 6.4 + i * 0.7);
    });
    // Reinvia email.
    view(10.4, 1.0, rb.x - 120, rb.y - 20, 1.3);
    curAt(rb.x + 260, rb.y + 120);
    curShow(11.2, true);
    curTo(11.3, 1.4, { x: rb.x, y: rb.y });
    press(12.8, '#${id}-reinvia');
    tap(12.8);
    gsap.set('#${id}-ok', { x: rb.x - 330, y: rb.y + 60 });
    tl.fromTo('#${id}-ok', { opacity: 0, y: rb.y + 80 }, { opacity: 1, y: rb.y + 60, duration: 0.4, ease: 'power3.out' }, 13.0);
    curShow(13.4, false);
    tl.to('#${id}-ok', { opacity: 0, duration: 0.3 }, 14.9);
    view(15.0, 1.1, win.x, win.y, 1.0);
    ${c.js}
  `;
  const sfx = [
    { t: 0.5, f: 'interface/bong_001.ogg', v: 0.5 },
    { t: 12.8, f: 'interface/click_003.ogg', v: 0.55 },
    { t: 13.0, f: 'impact/impactSoft_medium_003.ogg', v: 0.45 },
  ];
  return { id, dur, css, body, script, chapter: { n: '3', t: 'Cosa vedi nel CRM' }, sfx };
}
