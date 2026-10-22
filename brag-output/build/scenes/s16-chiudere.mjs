import { runtime, caps, CURSOR_SVG } from '../lib.mjs';
import { scheda } from '../ui.mjs';

// Capitolo 5 — chiudere: Vinta (abbonamento + valore), Persa (perché), Annullata (solo errori).
export default async function () {
  const id = 's16';
  const dur = 29;
  const lista = [
    { t: 0.8, d: 3.0, h: 'Quando si iscrive: <b>Stato → Vinta</b>.' },
    { t: 5.9, d: 3.2, h: 'Scrivi <b>quale abbonamento</b> e quanto vale.' },
    { t: 11.2, d: 3.4, h: 'Vinta: <b>abbonamento e valore</b> restano sulla scheda.' },
    { t: 15.4, d: 4.0, h: '<b>Persa</b>: scrivi perché non si iscrive. La nota è obbligatoria.' },
    { t: 19.8, d: 4.0, h: '<b>Annullata</b> è per gli errori: doppione, errore al banco, prova.' },
    { t: 24.2, d: 4.2, h: 'Ti sei sbagliato? <b>Puoi sempre correggere</b>: si torna In gestione.' },
  ];
  const c = caps(id, lista, dur);
  const campo = (cid, larg, ph, testo) =>
    `<div id="${cid}" style="position:relative;display:inline-block;width:${larg};height:2.1em;overflow:hidden;white-space:nowrap;vertical-align:middle;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:var(--text-xs)">
        <span id="${cid}-ph" style="position:absolute;left:0.55rem;top:0.34rem;color:var(--text-muted)">${ph}</span>
        ${testo ? `<span id="${cid}-t" style="position:absolute;left:0.55rem;top:0.34rem">${[...testo].map((ch) => `<span style="opacity:0">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</span>` : ''}
      </div>`;
  const chiusura = `<div class="lead-chiusura" id="${id}-chiu" style="opacity:0;flex-basis:100%">
        ${campo(id + '-m', '20rem', 'Quale abbonamento? Es. «Club Full annuale»', 'Club Full annuale')}
        ${campo(id + '-v', '5.2rem', '€', '1080')}
        <button class="btn btn-sm" type="button" id="${id}-salva">Salva</button><button class="btn btn-ghost btn-sm" type="button">Annulla</button>
      </div>`;
  const dlExtra = `<dt style="opacity:0" class="${id}-x">Chiuso</dt><dd style="opacity:0" class="${id}-x">24 ott 2026, 11:40 · 1.080,00 €</dd>
          <dt style="opacity:0" class="${id}-x">Nota</dt><dd style="opacity:0" class="${id}-x">Club Full annuale</dd>`;
  const html = scheda({ id: id + 's', conAzioni: false, comandiExtra: chiusura, dlExtra }).replace(/<div class="page-head"[\s\S]*?<\/div>\s*<\/div>/, '');
  const css = `
    #${id}-A { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; }
    #${id}-B { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; opacity: 0; }
    #${id}-ddl { position: absolute; width: 190px; padding: 4px; background: #fdfaf3; border: 1px solid rgba(28,28,24,.3); border-radius: 6px;
      box-shadow: 0 10px 24px rgba(28,28,24,.22); font-size: 15px; opacity: 0; z-index: 50; }
    #${id}-ddl div { padding: 5px 10px; border-radius: 4px; }
    #${id}-ddl div.on { background: rgba(139,108,20,.16); font-weight: 600; }
    #${id}-B .lead-chiusura input { width: 22rem; }
  `;
  // pannello B: i comandi con «Persa», poi «Annullata»
  const blocchiB = (stato, ph, cls) => `<div id="${id}-b-${cls}" style="position:absolute;left:28px;right:28px;top:24px;opacity:0">
      <div class="scheda-comandi"><span class="muted">In carico a · stato</span>
        <div class="lead-comandi"><select><option>Io</option></select><select><option>${stato}</option></select>
          <div class="lead-chiusura" style="flex-basis:100%"><div style="display:inline-block;width:30rem;max-width:100%;height:2.1em;overflow:hidden;white-space:nowrap;vertical-align:middle;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:var(--text-xs)"><span style="display:block;margin:0.34rem 0 0 0.55rem;color:var(--text-muted)">${ph}</span></div>
          <button class="btn btn-sm" type="button" style="opacity:.45">Salva</button><button class="btn btn-ghost btn-sm" type="button">Annulla</button></div>
        </div></div></div>`;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-A">${html}</div>
        <div id="${id}-ddl"><div>Da prendere in carico</div><div>In gestione</div><div class="on">Vinta</div><div>Persa</div><div>Annullata</div></div>
        <div class="frag" id="${id}-B" style="height:150px">${blocchiB('Persa', 'Perché non si iscrive?', 'persa')}${blocchiB('Annullata', 'Perché non è una trattativa? Doppione, errore al banco, prova…', 'ann')}</div>
        <div class="cur" id="${id}-cur">${CURSOR_SVG}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const cmd = W('#${id}s-cmd'), lead = W('#${id}s-lead'), stato = W('#${id}s-stato'), salva = W('#${id}-salva'), mP = W('#${id}-m'), vP = W('#${id}-v'),
          bPersa = W('#${id}-B'), dl = W('#${id}s-lead .dati'), badge = W('#${id}s-badge');
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set('.${id}-x', { opacity: 0 });
    viewSet(cmd.x, cmd.y + 70, 1.9);
    tl.fromTo('#${id}-A', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    // Stato → tendina → Vinta
    const dd = $('#${id}-ddl');
    gsap.set(dd, { x: stato.x - 40, y: stato.y + 18 });
    curAt(stato.x + 230, stato.y + 120);
    curShow(2.6, true);
    curTo(2.7, 1.0, { x: stato.x + 10, y: stato.y + 2 });
    tap(3.9);
    tl.fromTo(dd, { opacity: 0, y: stato.y + 8 }, { opacity: 1, y: stato.y + 18, duration: 0.18 }, 3.95);
    curTo(4.2, 0.5, { x: stato.x - 20, y: stato.y + 99 });
    tap(5.0);
    tl.to(dd, { opacity: 0, duration: 0.14 }, 5.1);
    tl.set('#${id}s-stato option', { innerHTML: 'Vinta' }, 5.12);
    tl.to('#${id}-chiu', { opacity: 1, duration: 0.3 }, 5.2);
    // scrive l'abbonamento e il valore, salva
    view(5.3, 0.9, cmd.x, cmd.y + 20, 2.0);
    curTo(6.4, 0.6, { x: mP.x - 60, y: mP.y + 3 });
    tap(7.1);
    tl.to('#${id}-m-ph', { opacity: 0, duration: 0.1 }, 7.15);
    const f1 = write(7.3, '#${id}-m-t', 16);
    curTo(f1 + 0.1, 0.5, { x: vP.x - 20, y: vP.y + 3 });
    tap(f1 + 0.75);
    tl.to('#${id}-v-ph', { opacity: 0, duration: 0.1 }, f1 + 0.8);
    const f2 = write(f1 + 0.9, '#${id}-v-t', 8);
    curTo(f2 + 0.15, 0.6, { x: salva.x, y: salva.y });
    tap(f2 + 1.0); press(f2 + 1.0, '#${id}-salva');
    // esito: badge «Vinta» verde, il valore e la nota compaiono
    const W0 = f2 + 1.15;
    tl.to('#${id}-chiu', { opacity: 0, duration: 0.2 }, W0);
    tl.to('#${id}s-badge', { opacity: 0, duration: 0.1 }, W0);
    tl.set('#${id}s-badge', { innerHTML: 'Vinta', className: 'badge badge-stato badge-punto badge-ok' }, W0 + 0.1);
    tl.to('#${id}s-badge', { opacity: 1, duration: 0.25 }, W0 + 0.11);
    tl.to('.${id}-x', { opacity: 1, duration: 0.4, stagger: 0.08 }, W0 + 0.2);
    curShow(W0 + 0.3, false);
    view(W0 + 0.2, 1.0, dl.x, dl.y + 20, 1.9);
    // Persa e Annullata
    tl.to('#${id}-A', { opacity: 0, duration: 0.3 }, 15.0);
    view(15.0, 0.01, bPersa.x, bPersa.y + 30, 2.2);
    tl.to('#${id}-B', { opacity: 1, duration: 0.3 }, 15.1);
    tl.to('#${id}-b-persa', { opacity: 1, duration: 0.3 }, 15.1);
    tl.to('#${id}-b-persa', { opacity: 0, duration: 0.25 }, 19.5);
    tl.to('#${id}-b-ann', { opacity: 1, duration: 0.3 }, 19.7);
    ${c.js}
  `;
  const sfx = [
    { t: 3.9, f: 'interface/click_003.ogg', v: 0.5 }, { t: 5.0, f: 'interface/click_002.ogg', v: 0.5 },
    { t: 7.1, f: 'interface/click_003.ogg', v: 0.5 },
    { t: 7.8, f: 'interface/click_005.ogg', v: 0.22 }, { t: 8.3, f: 'interface/click_002.ogg', v: 0.22 }, { t: 8.8, f: 'interface/click_005.ogg', v: 0.22 },
    { t: 11.05, f: 'impact/impactBell_heavy_000.ogg', v: 0.55 },
  ];
  return { id, dur, css, body, script, chapter: { n: '5', t: 'Chiudere' }, sfx };
}
