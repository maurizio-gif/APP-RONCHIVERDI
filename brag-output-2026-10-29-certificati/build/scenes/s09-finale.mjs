import { runtime } from '../lib.mjs';

// Da ricordare: quattro righe, poi la frase finale (≥ 2 s a schermo).
export default async function () {
  const id = 's09';
  const dur = 17;
  const righe = [
    'Alla vendita: la sigla <b>«(cer000)»</b> nel prodotto.',
    'Il codice parte da solo e vale <b>12 mesi</b>.',
    'Non è arrivato? <b>«Reinvia email»</b> nel CRM.',
    'Il certificato va alla casella dedicata: la data in Info4U si inserisce <b>a mano</b>.',
  ];
  const css = `
    #${id}-glow { position: absolute; left: 120px; top: 120px; width: 700px; height: 700px; border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(200,153,31,0.24) 0%, rgba(200,153,31,0.08) 50%, rgba(200,153,31,0) 74%); }
    #${id}-h { position: absolute; left: 140px; top: 120px; font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 110px; color: #f6efde; }
    .rg { position: absolute; left: 140px; width: 1640px; font-size: 44px; line-height: 1.25; color: rgba(246,239,222,.95); padding-left: 44px; border-left: 5px solid #c8991f; }
    .rg b { color: #efbf48; font-weight: 600; }
    #${id}-fin { position: absolute; left: 0; right: 0; top: 800px; text-align: center; font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 500; font-size: 84px; color: #e3b341; }
  `;
  const body = `
      <div id="${id}-glow"></div>
      <div id="${id}-h">Da ricordare</div>
      ${righe.map((r, i) => `<div class="rg" id="${id}-r${i}" style="top:${290 + i * 120}px" data-hold>${r}</div>`).join('')}
      <div id="${id}-fin" data-hold>Un codice. Dodici mesi. Una casella.</div>
  `;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.4, 0.8);
    tl.fromTo('#${id}-glow', { opacity: 0 }, { opacity: 1, duration: 1.0 }, 0);
    tl.fromTo('#${id}-h', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 0.3);
    ${righe.map((_, i) => `tl.fromTo('#${id}-r${i}', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' }, ${(1.2 + i * 2.2).toFixed(2)});`).join('\n    ')}
    tl.fromTo('#${id}-fin', { opacity: 0, filter: 'blur(8px)', y: 12 }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.6, ease: 'power3.out' }, 11.4);
  `;
  const sfx = [
    ...righe.map((_, i) => ({ t: 1.2 + i * 2.2, f: 'interface/drop_002.ogg', v: 0.35 })),
    { t: 11.4, f: 'impact/impactBell_heavy_000.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, dark: true, sfx };
}
