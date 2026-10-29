import { runtime, caps } from '../lib.mjs';
import { MAIL_CSS, chipOro } from '../mock.mjs';

// Passo 2: l'email col voucher. Testi presi da voucher-email-testi.ts.
export default async function () {
  const id = 's03';
  const dur = 16;
  const lista = [
    { t: 0.9, d: 4.0, h: 'Il socio riceve <b>subito</b> l’email con il voucher.' },
    { t: 5.2, d: 4.4, h: 'Un codice di otto cifre, <b>valido 12 mesi</b> dall’emissione.' },
    { t: 10.0, d: 5.2, h: 'Si prenota <b>online</b>, nel campo «Note», oppure <b>al telefono</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `${MAIL_CSS}
    #${id}-mail { left: 540px; top: 40px; width: 840px; }
    #${id}-t15 { left: 120px; top: 70px; }
    #${id}-cod, #${id}-val { display: inline-block; border-radius: 10px; }
    #${id}-note { margin-top: 10px; padding: 14px 18px; border-left: 5px solid #c8991f; background: rgba(200,153,31,0.14); font-size: 28px; border-radius: 6px; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag mail" id="${id}-mail">
          <div class="mail-testa">Ronchiverdi Sport Club</div>
          <div class="mail-corpo">
            <p class="mail-ogg">Il tuo voucher per la visita medica inclusa</p>
            <p>Ciao Mario,<br>con il tuo abbonamento hai diritto alla visita medico-sportiva in omaggio presso Chiron.</p>
            <p class="mail-et">Il tuo codice</p>
            <div class="mail-cod" id="${id}-cod">1234 5678</div>
            <p id="${id}-val">Intestato a Mario Rossi · valido fino al <b>29/10/2027</b></p>
            <div id="${id}-note"><b>Online</b>: scrivi il codice nel campo «Note». <b>Al telefono</b>: comunicalo all’operatore.</div>
          </div>
        </div>
        <div class="frag" id="${id}-t15" style="background:transparent;box-shadow:none;overflow:visible">${chipOro(id + '-chip', 'entro circa 15 minuti')}</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const m = W('#${id}-mail');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(m.x, m.y + 20, 1.0);
    tl.fromTo('#${id}-mail', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 0.4);
    tl.fromTo('#${id}-t15', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, 1.2);
    tl.to('#${id}-t15', { opacity: 0, duration: 0.3 }, 4.6);
    tl.to('#${id}-cod', { scale: 1.07, duration: 0.45, ease: 'power2.out', transformOrigin: '0% 50%' }, 5.4);
    tl.to('#${id}-cod', { scale: 1, duration: 0.4 }, 6.2);
    tl.to('#${id}-val', { backgroundColor: 'rgba(200,153,31,0.30)', duration: 0.4 }, 6.6);
    tl.to('#${id}-val', { backgroundColor: 'rgba(200,153,31,0)', duration: 0.4 }, 9.2);
    tl.to('#${id}-note', { backgroundColor: 'rgba(200,153,31,0.34)', duration: 0.4 }, 10.2);
    view(10.4, 5.4, m.x, m.y + 5, 1.04, 'sine.inOut');
    ${c.js}
  `;
  const sfx = [
    { t: 0.45, f: 'interface/bong_001.ogg', v: 0.55 },
    { t: 1.25, f: 'interface/drop_001.ogg', v: 0.4 },
    { t: 5.45, f: 'impact/impactSoft_medium_002.ogg', v: 0.45 },
  ];
  return { id, dur, css, body, script, chapter: { n: '2', t: 'Il socio riceve il codice' }, sfx };
}
