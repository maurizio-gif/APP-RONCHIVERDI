import { runtime, caps } from '../lib.mjs';

// Dopo l'email: il lavoro manuale della segreteria.
export default async function () {
  const id = 's08';
  const dur = 15;
  const lista = [
    { t: 0.9, d: 4.2, h: 'Poi tocca alla segreteria: <b>controlla</b> che il certificato vada bene.' },
    { t: 5.4, d: 3.8, h: 'Inserisci la <b>data in Info4U, a mano</b>.' },
    { t: 9.8, d: 4.4, h: 'L’email <b>resta salvata</b> nella casella dedicata.' },
  ];
  const c = caps(id, lista, dur);
  const passi = [
    ['Controlla', 'Il certificato è leggibile e va bene'],
    ['Inserisci', 'La data in Info4U, a mano'],
    ['Resta in casella', 'L’email rimane salvata in certificatimedici@ronchiverdi.it'],
  ];
  const css = `
    .st { position: absolute; top: 220px; width: 540px; height: 440px; background: #fdfaf3; border-radius: 18px; padding: 30px 32px;
          box-shadow: 0 24px 60px rgba(28,28,24,.16), 0 0 0 1px rgba(28,28,24,.10); }
    .st-n { width: 80px; height: 80px; border-radius: 50%; background: #8b6c14; color: #fdfaf3; display: grid; place-items: center;
            font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 56px; }
    .st-t { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 64px; line-height: 1.05; margin: 28px 0 14px; }
    .st-s { font-size: 31px; line-height: 1.3; color: #3d3d33; word-break: break-word; }
  `;
  const body = passi
    .map(
      ([t, s], i) => `
      <div class="st" id="${id}-p${i}" style="left:${96 + i * 596}px" data-hold>
        <div class="st-n">${i + 1}</div><div class="st-t">${t}</div><div class="st-s">${s}</div>
      </div>`
    )
    .join('') + c.html;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.35, 0.4);
    ${[0.5, 5.2, 9.6].map((t, i) => `tl.fromTo('#${id}-p${i}', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }, ${t});`).join('\n    ')}
    ${c.js}
  `;
  const sfx = [0.55, 5.25, 9.65].map((t) => ({ t, f: 'interface/drop_002.ogg', v: 0.4 }));
  return { id, dur, css, body, script, chapter: { n: '5', t: 'Poi, la segreteria' }, sfx };
}
