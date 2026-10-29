import { runtime } from '../lib.mjs';

// Scheda scura con il logo: il titolo è già a schermo al frame 0 (è la miniatura).
export default async function () {
  const id = 's00';
  const dur = 7;
  const css = `
    #${id}-glow { position: absolute; left: 560px; top: 250px; width: 800px; height: 520px; border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(200,153,31,0.30) 0%, rgba(200,153,31,0.10) 45%, rgba(200,153,31,0) 72%); }
    #${id}-logo { position: absolute; left: 780px; top: 80px; width: 360px; opacity: 0.96; }
    #${id}-logo img { display: block; width: 360px; height: auto; }
    #${id}-title { position: absolute; left: 0; right: 0; top: 300px; text-align: center; font-family: 'Cormorant Garamond', serif;
      font-weight: 700; font-size: 210px; line-height: 1; letter-spacing: -0.012em; color: #f6efde; margin: 0; }
    #${id}-rule { position: absolute; left: 910px; top: 560px; width: 100px; height: 3px; background: #c8991f; transform-origin: 50% 50%; }
    #${id}-tag { position: absolute; left: 0; right: 0; top: 592px; text-align: center; font-family: 'Cormorant Garamond', serif;
      font-style: italic; font-weight: 500; font-size: 84px; line-height: 1.1; color: #e3b341; }
    #${id}-sub { position: absolute; left: 280px; right: 280px; top: 780px; text-align: center; font-weight: 500; font-size: 40px; color: rgba(246,239,222,0.92); }
  `;
  const body = `
      <div id="${id}-glow"></div>
      <div id="${id}-logo"><img src="assets/img/logo-crema.png" alt="Ronchiverdi Sport Club" /></div>
      <h1 id="${id}-title">Certificati medici</h1>
      <div id="${id}-rule"></div>
      <div id="${id}-tag">Il nuovo processo con Chiron</div>
      <div id="${id}-sub" data-hold>Guida per la segreteria</div>
  `;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0, 0.4);
    gsap.set('#${id}-rule', { scaleX: 0 });
    tl.fromTo('#${id}-title', { filter: 'blur(10px)' }, { filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 0);
    tl.fromTo('#${id}-glow', { opacity: 0.3 }, { opacity: 1, duration: 1.4, ease: 'power2.out' }, 0);
    tl.fromTo('#${id}-logo', { opacity: 0, y: -14 }, { opacity: 0.96, y: 0, duration: 0.7, ease: 'power3.out' }, 0.2);
    tl.to('#${id}-rule', { scaleX: 1, duration: 0.6, ease: 'power3.out' }, 1.0);
    tl.fromTo('#${id}-tag', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 1.4);
    tl.fromTo('#${id}-sub', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 2.6);
  `;
  const sfx = [
    { t: 0.12, f: 'impact/impactSoft_medium_001.ogg', v: 0.7 },
    { t: 1.4, f: 'interface/drop_001.ogg', v: 0.45 },
  ];
  return { id, dur, css, body, script, dark: true, sfx };
}
