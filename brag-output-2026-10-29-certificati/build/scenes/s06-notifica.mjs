import { runtime, caps } from '../lib.mjs';
import { MAIL_CSS } from '../mock.mjs';

// Dopo la bruciatura: il socio riceve la notifica, la segreteria vede «Utilizzato».
export default async function () {
  const id = 's06';
  const dur = 15;
  const lista = [
    { t: 0.9, d: 4.6, h: 'Il socio riceve <b>subito</b> una notifica: il codice è stato usato.' },
    { t: 6.0, d: 5.0, h: 'In segreteria il voucher passa a <b>«Utilizzato»</b>, con data, ora e chi l’ha usato.' },
    { t: 11.4, d: 3.4, h: 'Nessun uso <b>all’insaputa del socio</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `${MAIL_CSS}
    #${id}-mail { left: 120px; top: 60px; width: 820px; }
    #${id}-crm { left: 1000px; top: 120px; width: 700px; padding: 26px 30px 30px; }
    #${id}-crm .cella-chi-nome { font-size: 34px; }
    #${id}-crm .cella-chi-dettagli { font-size: 28px; }
    #${id}-crm .badge { font-size: 28px; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag mail" id="${id}-mail">
          <div class="mail-testa">Ronchiverdi Sport Club</div>
          <div class="mail-corpo">
            <p class="mail-ogg">Il tuo voucher è stato utilizzato</p>
            <p>Ciao Mario,<br>il codice <b>1234 5678</b> è stato utilizzato da Chiron il <b>29/10/2026, 11:05</b> per prenotare la tua visita medico-sportiva. Da questo momento il codice non è più spendibile.</p>
            <p>Non hai prenotato tu? Rispondi a questa email: controlliamo subito.</p>
          </div>
        </div>
        <div class="frag" id="${id}-crm">
          <p class="eyebrow">Voucher visita medica</p>
          <div class="cella-chi-nome">Mario Rossi</div>
          <div class="cella-chi-dettagli">mario.rossi@example.it</div>
          <div style="margin-top:18px;position:relative;height:96px">
            <div id="${id}-b1" style="position:absolute;left:0;top:0"><span class="badge badge-ok">Attivo</span></div>
            <div id="${id}-b2" style="position:absolute;left:0;top:0;opacity:0"><span class="badge">Utilizzato</span><div class="cella-chi-dettagli">29/10/2026, 11:05 · Chiron</div></div>
          </div>
        </div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const m = W('#${id}-mail'), r = W('#${id}-crm');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(960, m.y + 10, 1.0);
    tl.fromTo('#${id}-mail', { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 0.3);
    tl.fromTo('#${id}-crm', { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 5.8);
    tl.to('#${id}-b1', { opacity: 0, duration: 0.2 }, 7.6);
    tl.to('#${id}-b2', { opacity: 1, duration: 0.3 }, 7.8);
    view(0.5, 5.3, m.x, m.y + 30, 1.08, 'sine.inOut');
    view(6.0, 9.0, 960, m.y + 40, 1.04, 'sine.inOut');
    ${c.js}
  `;
  const sfx = [
    { t: 0.4, f: 'interface/bong_001.ogg', v: 0.5 },
    { t: 5.9, f: 'interface/drop_001.ogg', v: 0.4 },
    { t: 7.8, f: 'impact/impactSoft_medium_002.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, chapter: { n: '4', t: 'Il socio e la segreteria lo sanno subito' }, sfx };
}
