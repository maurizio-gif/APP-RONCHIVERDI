import { runtime } from '../lib.mjs';

// Le schede-capitolo: nero caldo, numero in oro, titolo Cormorant. Una per capitolo, 3 s.
export const CAPITOLI = {
  ca1: { n: '1', t: 'Da dove arrivano', s: 'Le cinque fonti dei lead' },
  ca2: { n: '2', t: 'Prendere in carico', s: 'Avviso, Dashboard New, «Prendi in carico»' },
  ca3: { n: '3', t: 'L’Agenda', s: 'Calendario e vista elenco', musicaCambia: true },
  ca4: { n: '4', t: 'Lavorare un lead', s: 'Dalla scheda del contatto', musicaCambia: true },
  ca5: { n: '5', t: 'Chiudere', s: 'Vinta, Persa, Annullata' },
  ca6: { n: '6', t: 'Il lead non arriva da solo', s: 'Aggiungi in agenda e Phone In', musicaCambia: true },
};

export function card(id) {
  const c = CAPITOLI[id];
  const dur = 3.4;
  const css = `
    #${id}-glow { position: absolute; left: 80px; top: 200px; width: 760px; height: 700px; border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(200,153,31,0.26) 0%, rgba(200,153,31,0.08) 50%, rgba(200,153,31,0) 74%); }
    #${id}-n { position: absolute; left: 190px; top: 190px; width: 460px; text-align: center; font-family: 'Cormorant Garamond', serif;
      font-weight: 600; font-size: 520px; line-height: 1; color: #c8991f; }
    #${id}-k { position: absolute; left: 790px; top: 372px; font-weight: 500; font-size: 32px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(246,239,222,0.78); }
    #${id}-t { position: absolute; left: 790px; top: 424px; width: 1040px; font-family: 'Cormorant Garamond', serif; font-weight: 700;
      font-size: 112px; line-height: 1.02; color: #f6efde; }
    #${id}-t span { display: inline-block; margin-right: 0.22em; }
    #${id}-s { position: absolute; left: 790px; width: 1000px; font-weight: 400; font-size: 38px; line-height: 1.25; color: rgba(246,239,222,0.88); }
  `;
  const parole = c.t.split(' ');
  // il sottotitolo sta sotto il titolo: 1 o 2 righe di titolo
  const righe = c.t.length > 22 ? 2 : 1;
  const sTop = 424 + righe * 114 + 26;
  const body = `
      <div id="${id}-glow"></div>
      <div id="${id}-n">${c.n}</div>
      <div id="${id}-k">Capitolo ${c.n}</div>
      <div id="${id}-t">${parole.map((p, i) => `<span id="${id}-w${i}">${p}</span>`).join('')}</div>
      <div id="${id}-s" style="top:${sTop}px">${c.s}</div>
  `;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.25, 0.3);
    tl.fromTo('#${id}-glow', { opacity: 0 }, { opacity: 1, duration: 0.9, ease: 'power2.out' }, 0);
    tl.fromTo('#${id}-n', { opacity: 0, filter: 'blur(14px)', x: -30 }, { opacity: 1, filter: 'blur(0px)', x: 0, duration: 0.6, ease: 'expo.out' }, 0.1);
    tl.fromTo('#${id}-k', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.3);
    ${parole.map((p, i) => `tl.fromTo('#${id}-w${i}', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.18, ease: 'power3.out' }, ${(0.35 + i * 0.067).toFixed(3)});`).join('\n    ')}
    tl.fromTo('#${id}-s', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 0.5);
  `;
  const sfx = [{ t: 0.15, f: 'impact/impactSoft_medium_00' + ((+c.n % 4) + 1) + '.ogg', v: 0.62 }];
  return { id, dur, css, body, script, dark: true, sfx, musicaCambia: !!c.musicaCambia };
}

export default null;
