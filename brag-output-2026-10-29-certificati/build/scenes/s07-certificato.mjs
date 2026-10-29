import { runtime, caps } from '../lib.mjs';

// Passo 5: il certificato arriva per email alla casella dedicata (scena scura).
export default async function () {
  const id = 's07';
  const dur = 18;
  const lista = [
    { t: 1.0, d: 4.4, h: 'Dopo la visita il certificato <b>non si prende più fisicamente</b>.' },
    { t: 6.0, d: 4.6, h: 'Il socio lo invia <b>in allegato via email</b>: è l’unica modalità.' },
    { t: 11.6, d: 5.2, h: 'Ha solo il cartaceo? In reception <b>lo fotografiamo e lo inviamo</b> insieme a lui.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-all .chap, #${id}-all .chap i { color: #e3b341; }
    #${id}-glow { position: absolute; left: 360px; top: 60px; width: 1200px; height: 460px; border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(200,153,31,0.26) 0%, rgba(200,153,31,0.08) 50%, rgba(200,153,31,0) 74%); }
    #${id}-addr { position: absolute; left: 0; right: 0; top: 190px; text-align: center; font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 104px; color: #e3b341; }
    #${id}-lab { position: absolute; left: 0; right: 0; top: 140px; text-align: center; font-weight: 500; font-size: 28px; letter-spacing: .2em; text-transform: uppercase; color: rgba(246,239,222,.78); }
    .cd { position: absolute; top: 400px; width: 640px; height: 290px; border-radius: 18px; padding: 26px 32px; background: #2a2a24; border: 1px solid rgba(246,239,222,.2); color: #f6efde; }
    .cd h3 { margin: 0 0 12px; font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 50px; color: #f6efde; }
    .cd p { margin: 0; font-size: 28px; line-height: 1.35; color: rgba(246,239,222,.92); }
    .cd-all { display: inline-block; margin-top: 16px; padding: 10px 20px; border-radius: 10px; background: rgba(246,239,222,.12); font-weight: 500; font-size: 28px; }
    #${id}-a1 { left: 240px; } #${id}-a2 { left: 1040px; }
  `;
  const body = `
      <div id="${id}-glow"></div>
      <div id="${id}-lab">Casella dedicata</div>
      <div id="${id}-addr">certificatimedici@ronchiverdi.it</div>
      <div class="cd" id="${id}-a1" data-hold><h3>Dal socio</h3><p>Email con il certificato <b>in allegato</b>.</p><span class="cd-all">📎 certificato.pdf</span></div>
      <div class="cd" id="${id}-a2" data-hold><h3>In reception</h3><p>Ha solo il cartaceo: lo fotografiamo e lo inviamo <b>insieme al socio</b>.</p></div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.35, 0.5);
    tl.fromTo('#${id}-glow', { opacity: 0 }, { opacity: 1, duration: 1.0 }, 0);
    tl.fromTo('#${id}-lab', { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.5);
    tl.fromTo('#${id}-addr', { opacity: 0, filter: 'blur(10px)', y: 14 }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.7, ease: 'power3.out' }, 0.7);
    tl.fromTo('#${id}-a1', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 6.2);
    tl.fromTo('#${id}-a2', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 11.8);
    tl.to('#${id}-glow', { scale: 1.25, x: 60, duration: 17, ease: 'sine.inOut' }, 0.5);
    tl.to('#${id}-addr', { y: -8, duration: 12, ease: 'sine.inOut' }, 2);
    ${c.js}
  `;
  const sfx = [
    { t: 0.7, f: 'impact/impactSoft_medium_001.ogg', v: 0.6 },
    { t: 6.2, f: 'interface/drop_002.ogg', v: 0.4 },
    { t: 11.8, f: 'interface/drop_002.ogg', v: 0.4 },
  ];
  return { id, dur, css, body, script, dark: true, chapter: { n: '5', t: 'Il certificato' }, sfx };
}
