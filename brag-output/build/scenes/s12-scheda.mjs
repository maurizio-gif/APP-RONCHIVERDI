import { runtime, caps } from '../lib.mjs';
import { scheda, rigaRichiamo } from '../ui.mjs';

// Capitolo 4 — la scheda del contatto: recapiti, card Lead (da dove arriva, cosa ha chiesto, messaggio), comandi.
export default async function () {
  const id = 's12';
  const dur = 15.5;
  const lista = [
    { t: 0.9, d: 3.6, h: 'In testa: <b>telefono, WhatsApp ed email</b>, a un clic.' },
    { t: 4.8, d: 5.0, h: 'Da dove arriva, cosa ha chiesto, <b>cosa ha scritto</b>: tutto in una scheda.' },
    { t: 10.6, d: 4.2, h: '«In carico a» e «Stato» si cambiano <b>da qui</b>.' },
  ];
  const c = caps(id, lista, dur);
  const css = `#${id}-pg { left: 40px; top: 20px; width: 780px; padding: 24px 28px 22px; } #${id}-pg .card { margin-bottom: 1rem; }`;
  const html = scheda({ id: id + 's', ora: rigaRichiamo({ id: id + 'r', fascia: false }), oraConto: 1 });
  const body = `<div class="cam" id="${id}-cam"><div class="frag" id="${id}-pg">${html}</div></div>${c.html}`;
  const script =
    runtime(id) +
    `
    const ct = W('#${id}s-contatti'), lead = W('#${id}s-lead', 0.5, 0.36), cmd = W('#${id}s-cmd');
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set(['#${id}s-contatti', '#${id}s-da', '#${id}s-rich', '#${id}s-msg', '#${id}s-cmd'], { outline: '0px solid #17170f', outlineOffset: '4px' });
    viewSet(ct.x - 40, ct.y + 70, 2.2);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    tl.to('#${id}s-contatti', { outlineWidth: 4, duration: 0.25 }, 1.0);
    tl.to('#${id}s-contatti', { outlineWidth: 0, duration: 0.3 }, 4.0);
    view(4.4, 1.0, lead.x, lead.y + 20, 2.2);
    ${['da', 'rich', 'msg'].map((k, i) => `tl.to('#${id}s-${k}', { outlineWidth: 4, duration: 0.25 }, ${5.6 + i * 1.5});
    tl.to('#${id}s-${k}', { outlineWidth: 0, duration: 0.3 }, ${6.9 + i * 1.5});`).join('\n    ')}
    view(10.0, 1.0, cmd.x, cmd.y - 80, 2.2);
    tl.to('#${id}s-cmd', { outlineWidth: 4, duration: 0.25 }, 10.9);
    tl.to('#${id}s-cmd', { outlineWidth: 0, duration: 0.3 }, 14.4);
    ${c.js}
  `;
  return { id, dur, css, body, script, chapter: { n: '4', t: 'Lavorare un lead' }, sfx: [] };
}
