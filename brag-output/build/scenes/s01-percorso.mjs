import { runtime, caps } from '../lib.mjs';

// Il percorso di un lead: una linea che cresce, un punto (il lead) che avanza, i nomi dei passi appaiono quando si dicono.
export default async function () {
  const id = 's01';
  const dur = 16.2;
  const passi = [
    { n: 'Arriva', stato: 'Da prendere in carico', cls: 'badge-warn' },
    { n: 'Prendi in carico', stato: 'In gestione', cls: 'badge-info' },
    { n: 'Pianifica in Agenda', stato: 'In gestione', cls: 'badge-info' },
    { n: 'Chiama e registra', stato: 'In gestione', cls: 'badge-info' },
    { n: 'Vinta', stato: 'Vinta', cls: 'badge-ok' },
  ];
  const X0 = 250, DX = 355; // posizioni dei nodi
  const css = `
    #${id}-h { position: absolute; left: 96px; right: 96px; top: 128px; text-align: center; font-family: 'Cormorant Garamond', serif;
      font-weight: 600; font-size: 92px; line-height: 1; color: #17170f; }
    #${id}-h em { font-style: italic; color: #8b6c14; font-weight: 500; }
    #${id}-line { position: absolute; left: ${X0}px; top: 560px; width: ${DX * 4}px; height: 5px; background: #c9bd9b; border-radius: 3px; transform-origin: 0 50%; }
    #${id}-fill { position: absolute; left: ${X0}px; top: 560px; width: ${DX * 4}px; height: 5px; background: #8b6c14; border-radius: 3px; transform-origin: 0 50%; }
    .${id}-node { position: absolute; top: 540px; width: 46px; height: 46px; margin-left: -23px; border-radius: 50%; background: #fdfaf3;
      border: 4px solid #c9bd9b; box-sizing: border-box; }
    .${id}-lab { position: absolute; top: 432px; width: 330px; margin-left: -165px; text-align: center; font-weight: 600; font-size: 40px;
      line-height: 1.1; color: #17170f; }
    .${id}-num { position: absolute; top: 366px; width: 100px; margin-left: -50px; text-align: center; font-family: 'Cormorant Garamond', serif;
      font-weight: 600; font-size: 52px; color: #8b6c14; }
    .${id}-st { position: absolute; top: 654px; width: 520px; margin-left: -260px; text-align: center; white-space: nowrap; }
    .${id}-st .badge { font-size: 28px; padding: 8px 20px; }
    #${id}-dot { position: absolute; left: ${X0}px; top: 551px; width: 24px; height: 24px; margin-left: -12px; border-radius: 50%; background: #8b6c14;
      box-shadow: 0 0 0 10px rgba(139,108,20,0.18); }
    #${id}-who { position: absolute; left: ${X0 - 120}px; top: 746px; width: 240px; padding: 10px 0; text-align: center; border-radius: 10px;
      background: #1c1c18; color: #f6efde; font-weight: 500; font-size: 30px; }
    #${id}-brk { position: absolute; top: 600px; height: 34px; border: 3px solid #35566b; border-top: 0; border-radius: 0 0 14px 14px; opacity: 0; }
  `;
  const nodi = passi
    .map((p, i) => {
      const x = X0 + DX * i;
      return `
      <div class="${id}-num" id="${id}-num${i}" style="left:${x}px">${i + 1}</div>
      <div class="${id}-lab" id="${id}-lab${i}" style="left:${x}px">${p.n}</div>
      <div class="${id}-node" id="${id}-node${i}" style="left:${x}px"></div>
      ${i === 1 || i === 3 ? '' : `<div class="${id}-st" id="${id}-st${i}" style="left:${x}px"><span class="badge badge-punto badge-stato ${p.cls}">${p.stato}</span></div>`}`;
    })
    .join('');
  const c = caps(
    id,
    [{ t: 11.0, d: 4.7, h: 'Dall’Agenda gestisci tutto il <b>follow-up</b>, fino all’<b>iscrizione</b>.' }],
    dur
  );
  const body = `
      <div id="${id}-h" data-hold>Il percorso di un <em>lead</em></div>
      <div id="${id}-line"></div><div id="${id}-fill"></div>
      ${nodi}
      <div id="${id}-brk" style="left:${X0 + DX * 1 - 40}px;width:${DX * 2 + 80}px"></div>
      <div id="${id}-dot"></div>
      <div id="${id}-who">Chiara Morandi</div>
      ${c.html}
  `;
  // Tempi: il passo i compare a 1.7 + i*2.4 s e il punto lo raggiunge subito dopo.
  const T = (i) => +(1.5 + i * 2.05).toFixed(2);
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.4, 0.4);
    gsap.set('#${id}-fill', { scaleX: 0 });
    gsap.set('.${id}-lab, .${id}-num, .${id}-st, .${id}-node', { opacity: 0 });
    tl.fromTo('#${id}-h', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 0.3);
    tl.fromTo('#${id}-line', { scaleX: 0 }, { scaleX: 1, duration: 1.0, ease: 'power2.out' }, 0.9);
    tl.fromTo('#${id}-dot', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1.2);
    tl.fromTo('#${id}-who', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 1.3);
    ${passi
      .map((p, i) => {
        const t = T(i);
        const mov =
          i === 0
            ? ''
            : `tl.to('#${id}-dot', { x: ${DX * i}, duration: 0.8, ease: 'power3.inOut' }, ${(t - 0.7).toFixed(2)});
    tl.to('#${id}-who', { x: ${DX * i}, duration: 0.8, ease: 'power3.inOut' }, ${(t - 0.7).toFixed(2)});
    tl.to('#${id}-fill', { scaleX: ${(i / 4).toFixed(2)}, duration: 0.8, ease: 'power3.inOut' }, ${(t - 0.7).toFixed(2)});`;
        return `${mov}
    tl.fromTo(['#${id}-num${i}', '#${id}-lab${i}'], { opacity: 0, y: 14, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.4, ease: 'power3.out' }, ${t});
    tl.fromTo('#${id}-node${i}', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(1.6)' }, ${t});
    ${i === 1 || i === 3 ? '' : `tl.fromTo('#${id}-st${i}', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, ${(t + 0.25).toFixed(2)});`}
    ${i === 1 ? `tl.fromTo('#${id}-brk', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, ${(t + 0.3).toFixed(2)});` : ''}`;
      })
      .join('\n    ')}
    ${c.js}
  `;
  const sfx = passi.map((p, i) => ({ t: T(i) + 0.05, f: i === 4 ? 'impact/impactSoft_medium_002.ogg' : 'interface/drop_002.ogg', v: i === 4 ? 0.55 : 0.4 }));
  return { id, dur, css, body, script, chapter: null, sfx };
}
