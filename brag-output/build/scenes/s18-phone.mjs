import { runtime, caps } from '../lib.mjs';
import { sidebar } from '../ui.mjs';

// Capitolo 6 — Phone In / Email In per chi chiama o scrive; il Guest Register per chi arriva di persona.
export default async function () {
  const id = 's18';
  const dur = 13;
  const lista = [
    { t: 0.8, d: 5.7, h: 'Telefonata o email <b>quando nessun commerciale era disponibile</b>: si registra solo quello che è già successo.' },
    { t: 6.7, d: 5.4, h: 'Chi si presenta <b>di persona</b>? Fagli scansionare il QR code del Guest Register in reception.' },
  ];
  const c = caps(id, lista, dur);
  const css = `
    #${id}-side { left: 40px; top: 20px; position: absolute; border-radius: 10px; box-shadow: 0 24px 60px rgba(28,28,24,.28); overflow: hidden; }
    #${id}-pg { left: 330px; top: 20px; width: 820px; padding: 28px 30px 26px; }
    #${id}-pg .card { margin-top: 1rem; }
  `;
  const body = `
      <div class="cam" id="${id}-cam">
        ${sidebar({ id: id + '-side', attivo: 'phone', altezza: 600 }).replace('<a class="nav-item" id="s18-side-n-phone">', '<a class="nav-item is-active" id="s18-side-n-phone">')}
        <div class="frag" id="${id}-pg">
          <div class="page-head"><p class="eyebrow">Segreteria</p><h1>Phone In / Email In</h1>
            <p class="muted">Per una telefonata o un’email arrivate quando nessun commerciale era disponibile: si registra solo quello che è già successo, con chi ha chiamato o scritto.</p></div>
          <div class="card" id="${id}-card"><p class="muted" style="margin:0">Chi si presenta di persona non va registrato qui: fagli scansionare il QR code del Guest Register in reception. <a class="link" style="color:var(--accent);text-decoration:underline">Apri il Guest Register</a>.</p></div>
        </div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const nav = W('#${id}-side-n-phone'), pg = W('#${id}-pg'), card = W('#${id}-card');
    sceneInOut(${dur}, 0.35, 0.4);
    gsap.set(['#${id}-side-n-phone', '#${id}-card'], { outline: '0px solid #17170f', outlineOffset: '3px' });
    viewSet(pg.x - 130, pg.y + 80, 1.65);
    tl.fromTo('#${id}-pg', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    tl.fromTo('#${id}-side', { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, 0.2);
    view(6.3, 1.0, card.x - 20, card.y + 10, 2.1);
    tl.to('#${id}-card', { outlineWidth: 4, duration: 0.25 }, 7.2);
    tl.to('#${id}-card', { outlineWidth: 0, duration: 0.3 }, 12.0);
    ${c.js}
  `;
  return { id, dur, css, body, script, chapter: { n: '6', t: 'Il lead non arriva da solo' }, sfx: [] };
}
