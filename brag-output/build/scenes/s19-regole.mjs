import { runtime } from '../lib.mjs';

// Capitolo 7 — le regole del reparto New: cinque righe, ognuna col pezzo d'interfaccia vero; poi la frase finale.
export default async function () {
  const id = 's19';
  const T0 = 1.5, STEP = 3.1;
  const regole = [
    { t: 'Ogni lead nuovo ha un titolare.', ui: '<button type="button" class="btn">Prendi in carico</button>' },
    { t: 'Non risponde? Registra il tentativo.', ui: '<button type="button" class="btn btn-ghost">Non risponde, riprovo</button>' },
    { t: 'Dopo ogni chiamata, il prossimo passo in agenda.', ui: '<button type="button" class="btn">Aggiungi</button>' },
    { t: 'Vinta, Persa, Annullata: sempre con la nota.', ui: '<span class="badge badge-ok badge-punto badge-stato">Vinta</span> <span class="badge badge-ko badge-punto badge-stato">Persa</span> <span class="badge badge-off badge-punto badge-stato">Annullata</span>' },
    { t: 'Ogni mattina, guarda gli Arretrati.', ui: '<span class="chip is-attivo"><span class="chip-spunta">✓</span>Arretrati<span class="chip-conteggio">3</span></span>' },
  ];
  const tFine = T0 + regole.length * STEP + 1.2;
  const dur = +(tFine + 6.6).toFixed(1);
  const css = `
    #${id}-h { position: absolute; left: 160px; top: 96px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 84px; line-height: 1; color: #17170f; }
    #${id}-h em { font-style: italic; color: #8b6c14; font-weight: 500; }
    .${id}-r { position: absolute; left: 160px; width: 1600px; height: 108px; display: flex; align-items: center; gap: 36px; border-top: 1px solid rgba(28,28,24,.18); }
    .${id}-n { width: 74px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 74px; color: #8b6c14; line-height: 1; }
    .${id}-t { flex: 1; font-weight: 500; font-size: 44px; line-height: 1.1; color: #17170f; }
    .${id}-u { width: 520px; display: flex; justify-content: flex-end; font-size: 20px; }
    .${id}-u .btn { font-size: 22px; padding: 14px 26px; }
    .${id}-u .badge { font-size: 20px; padding: 8px 14px; }
    .${id}-u .chip { font-size: 24px; padding: 8px 20px; }
    .${id}-u .chip-conteggio { font-size: 20px; }
    #${id}-fin { position: absolute; left: 0; right: 0; top: 380px; text-align: center; font-family: 'Cormorant Garamond', serif; font-weight: 600;
      font-size: 108px; line-height: 1.08; color: #17170f; padding: 0 160px; opacity: 0; }
    #${id}-fin em { font-style: italic; color: #8b6c14; font-weight: 500; }
  `;
  const righe = regole
    .map((r, i) => `<div class="${id}-r" data-hold id="${id}-r${i}" style="top:${232 + i * 118}px;opacity:0"><div class="${id}-n">${i + 1}</div><div class="${id}-t">${r.t}</div><div class="${id}-u">${r.ui}</div></div>`)
    .join('\n      ');
  const body = `
      <div id="${id}-h">Le regole del <em>reparto New</em></div>
      <div id="${id}-list" data-hold>
      ${righe}
      </div>
      <div id="${id}-fin" data-hold>Dal primo contatto all’iscrizione: <em>tutto passa dall’Agenda.</em></div>
  `;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.4, 0.8);
    tl.fromTo('#${id}-h', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 0.3);
    ${regole.map((r, i) => `tl.fromTo('#${id}-r${i}', { opacity: 0, y: 20, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'power3.out' }, ${(T0 + i * STEP).toFixed(2)});`).join('\n    ')}
    // la frase finale prende il posto delle regole, e resta almeno 2 s
    tl.to(['#${id}-h', '#${id}-list'], { opacity: 0, filter: 'blur(8px)', duration: 0.5, ease: 'power2.in' }, ${tFine.toFixed(2)});
    tl.fromTo('#${id}-fin', { opacity: 0, filter: 'blur(8px)', y: 14 }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.7, ease: 'power3.out' }, ${(tFine + 0.45).toFixed(2)});
  `;
  const sfx = [
    ...regole.map((r, i) => ({ t: T0 + i * STEP + 0.05, f: 'interface/drop_00' + ((i % 3) + 1) + '.ogg', v: 0.4 })),
    { t: tFine + 0.55, f: 'impact/impactBell_heavy_003.ogg', v: 0.5 },
  ];
  return { id, dur, css, body, script, chapter: null, sfx };
}
