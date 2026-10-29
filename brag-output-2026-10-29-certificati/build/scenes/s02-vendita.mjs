import { runtime, caps } from '../lib.mjs';

// Passo 1: la sigla «(cer000)» nel nome del prodotto.
export default async function () {
  const id = 's02';
  const dur = 19.4;
  const lista = [
    { t: 0.9, d: 4.0, h: 'Tutto parte <b>al momento della vendita</b>, in Info4U.' },
    { t: 5.2, d: 4.6, h: 'Il nome del prodotto deve contenere la sigla <b>«(cer000)»</b>.' },
    { t: 10.2, d: 3.2, h: 'Senza sigla, <b>non parte nessun codice</b>.' },
    { t: 13.8, d: 4.6, h: 'Socio senza email? <b>Aggiungila entro 7 giorni</b>: il codice parte da solo.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-win { left: 380px; top: 70px; width: 1000px; padding: 34px 40px 38px; }
    #${id}-win .dati, #${id}-win .dati dt, #${id}-win .dati dd { font-size: 30px; }
    #${id}-prod { display: inline-block; font-weight: 600; font-size: 38px; padding: 4px 12px; margin: -4px -12px; border-radius: 10px; }
    #${id}-sig { color: #8b6c14; border-radius: 8px; padding: 0 6px; box-shadow: 0 0 0 3px rgba(200,153,31,0); }
    #${id}-mail { display: inline-block; padding: 4px 12px; margin: -4px -12px; border-radius: 10px; }
    #${id}-tempo { left: 1060px; top: 470px; opacity: 0; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-win">
          <p class="eyebrow">Info4U · al momento della vendita</p>
          <h1 style="font-size:64px;margin:0 0 22px">Vendita abbonamento</h1>
          <dl class="dati">
            <dt>Socio</dt><dd>Mario Rossi</dd>
            <dt>Prodotto</dt><dd><span id="${id}-prod">1.1 GOLD OVER 35 <span id="${id}-sig">(cer000)</span></span></dd>
            <dt>Email</dt><dd><span id="${id}-mail">mario.rossi@example.it</span></dd>
          </dl>
        </div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const win = W('#${id}-win'), sig = W('#${id}-sig'), ml = W('#${id}-mail');
    sceneInOut(${dur}, 0.35, 0.4);
    viewSet(win.x, win.y, 1.25);
    tl.fromTo('#${id}-win', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    tl.to('#${id}-prod', { backgroundColor: 'rgba(139,108,20,0.10)', duration: 0.4 }, 5.4);
    tl.to('#${id}-sig', { backgroundColor: 'rgba(200,153,31,0.35)', boxShadow: '0 0 0 3px rgba(200,153,31,0.6)', duration: 0.5, ease: 'power2.out' }, 6.0);
    tl.to('#${id}-sig', { scale: 1.08, duration: 0.5, ease: 'power2.inOut', yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, 7.4);
    tl.to('#${id}-prod', { backgroundColor: 'rgba(139,108,20,0)', duration: 0.4 }, 10.4);
    tl.to('#${id}-mail', { backgroundColor: 'rgba(53,86,107,0.14)', duration: 0.4 }, 14.0);
    ${c.js}
  `;
  const sfx = [
    { t: 0.5, f: 'interface/bong_001.ogg', v: 0.5 },
    { t: 6.0, f: 'interface/click_003.ogg', v: 0.5 },
    { t: 14.0, f: 'interface/drop_001.ogg', v: 0.4 },
  ];
  return { id, dur, css, body, script, chapter: { n: '1', t: 'Alla vendita' }, sfx };
}
