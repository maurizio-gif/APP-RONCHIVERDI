import { runtime, caps } from '../lib.mjs';

// I cinque passi in una fila: la mappa prima del dettaglio.
export default async function () {
  const id = 's01';
  const dur = 12;
  const lista = [
    { t: 1.0, d: 4.8, h: 'Cinque passi, <b>quasi tutti in automatico</b>.' },
    { t: 6.4, d: 5.0, h: 'Alla segreteria restano <b>la sigla alla vendita</b> e <b>la data del certificato</b>.' },
  ];
  const c = caps(id, lista, dur);
  const passi = [
    ['Vendita', 'Il prodotto ha la sigla «(cer000)»'],
    ['Codice', 'Parte da solo, per email, al socio'],
    ['Chiron', 'Verifica il codice e lo usa'],
    ['Certificato', 'Il socio lo invia alla casella dedicata'],
    ['Info4U', 'La segreteria inserisce la data'],
  ];
  const css = `
    .pz { position: absolute; top: 250px; width: 318px; height: 430px; background: #fdfaf3; border-radius: 18px; padding: 28px 26px;
          box-shadow: 0 24px 60px rgba(28,28,24,.16), 0 0 0 1px rgba(28,28,24,.10); }
    .pz-n { width: 74px; height: 74px; border-radius: 50%; background: #8b6c14; color: #fdfaf3; display: grid; place-items: center;
            font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 52px; }
    .pz-t { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 58px; line-height: 1.05; margin: 26px 0 14px; }
    .pz-s { font-size: 30px; line-height: 1.3; color: #3d3d33; }
    .pz-auto { position: absolute; left: 26px; bottom: 24px; font-size: 28px; letter-spacing: .1em; text-transform: uppercase; color: #4a6b3a; font-weight: 600; }
    .pz-man { color: #8b6c14; }
  `;
  const body = passi
    .map(
      ([t, s], i) => `
      <div class="pz" id="${id}-p${i}" style="left:${96 + i * 348}px" data-hold>
        <div class="pz-n">${i + 1}</div>
        <div class="pz-t">${t}</div>
        <div class="pz-s">${s}</div>
        <div class="pz-auto ${i === 0 || i === 4 ? 'pz-man' : ''}">${i === 0 || i === 4 ? 'a mano' : 'automatico'}</div>
      </div>`
    )
    .join('') + c.html;
  const script =
    runtime(id) +
    `
    sceneInOut(${dur}, 0.35, 0.4);
    ${passi.map((_, i) => `tl.fromTo('#${id}-p${i}', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, ${(0.6 + i * 0.75).toFixed(2)});`).join('\n    ')}
    ${c.js}
  `;
  const sfx = passi.map((_, i) => ({ t: 0.7 + i * 0.75, f: 'interface/drop_002.ogg', v: 0.35 }));
  return { id, dur, css, body, script, chapter: { n: '•', t: 'Il processo' }, sfx };
}
