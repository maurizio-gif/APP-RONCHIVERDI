import { runtime, caps } from '../lib.mjs';
import { leadTesto } from '../ui.mjs';

// Capitolo 1 — le cinque fonti. Righe nello stile di ElencoLead; le frasi sono quelle di lib/provenienza.ts.
export default async function () {
  const id = 's02';
  const righe = [
    { nome: 'Chiara Morandi', prov: 'sito', rich: 'richiamami', tipo: 'telefono', dett: 'Abbonamento Club e Family', attesa: 'aperta oggi',
      cap: [{ d: 3.6, h: 'Ha scritto dal sito: <b>non l’ha ancora incontrato nessuno</b>.' }] },
    { nome: 'Luca Ferri', prov: 'banco', rich: 'in_sede', dett: 'Registrato al Guest Register', attesa: 'aperta oggi',
      cap: [
        { d: 4.5, h: 'Registrato al banco: <b>è già stato qui</b> e ha parlato con la segreteria.' },
        { d: 3.3, h: 'Il <b>Guest Register</b> è il QR code in reception.' },
      ] },
    { nome: 'Sara Bellini', prov: 'evento', dett: 'Registrata dal QR code di un evento', attesa: 'aperta oggi',
      cap: [{ d: 6.6, h: 'Si è registrato dal QR code di un evento: l’abbiamo <b>incontrato di persona</b>, ma non è passato dal banco.' }] },
    { nome: 'Marco Villa', prov: 'telefono', rich: 'telefonata', dett: 'Ha chiamato la segreteria', attesa: 'aperta oggi',
      cap: [{ d: 5.1, h: 'Ha telefonato o scritto alla segreteria: la telefonata o l’email sono <b>registrate in agenda</b>.' }] },
    { nome: 'Paola Conti', prov: 'agenda', dett: 'Evento scritto in agenda da un collega', attesa: 'aperta oggi',
      cap: [{ d: 6.4, h: 'Non è arrivata da una richiesta: l’ha aperta <b>qualcuno del club</b> scrivendo un evento in agenda su questa persona.' }] },
  ];
  // Tempi: ogni riga entra, poi le sue frasi in sequenza.
  const T0 = 0.9, GAP = 0.2;
  let t = T0;
  const arrivi = [];
  const lista = [];
  righe.forEach((r, i) => {
    arrivi.push(+t.toFixed(2));
    let tc = t + 0.3;
    r.cap.forEach((c) => {
      lista.push({ t: +tc.toFixed(2), d: c.d, h: c.h });
      tc += c.d + 0.1;
    });
    t = tc + GAP;
  });
  const T_OUT = +t.toFixed(2); // inizio della chiusa sulle due etichette
  const chiusa = { t: +(T_OUT + 2.4).toFixed(2), d: 6.0, h: 'Ogni arrivo è un lead <b>«Da prendere in carico»</b>: nessuno lo segue finché qualcuno non lo prende.' };
  lista.push(chiusa);
  const dur = Math.ceil(chiusa.t + chiusa.d + 0.6);

  const c = caps(id, lista, dur);
  const css = `
    #${id}-frag { left: 40px; top: 24px; width: 760px; padding: 14px 18px 4px; }
    #${id}-frag .riepilogo-testa { margin-bottom: 4px; }
    #${id}-cnt { display: inline-grid; }
    #${id}-cnt span { grid-area: 1 / 1; }
    .${id}-lab { position: absolute; padding: 4px 12px; background: #1c1c18; color: #f6efde; font-size: 16px; font-weight: 600; border-radius: 6px; white-space: nowrap; opacity: 0; }
    .${id}-lab::before { content: ''; position: absolute; left: 50%; top: calc(var(--stem) * -1); margin-left: -1.5px; width: 3px; height: var(--stem); background: #1c1c18; }
    #${id}-list { list-style: none; margin: 0; padding: 0; }
    #${id}-list .lead-riga { padding-top: 10px; padding-bottom: 10px; }
  `;
  const li = righe
    .map(
      (r, i) => `
        <li class="lead-riga riga-stato stato-nuovo" id="${id}-r${i}" style="opacity:0">
          ${leadTesto({ nome: r.nome, prov: r.prov, rich: r.rich, tipo: r.tipo, attesa: r.attesa })}
        </li>`
    )
    .join('');
  const body = `
      <div class="cam" id="${id}-cam">
        <div class="frag" id="${id}-frag">
          <div class="riepilogo-testa">
            <h2 class="riepilogo-titolo">Lead</h2>
            <span class="badge badge-warn badge-punto"><span id="${id}-cnt">${righe.map((_, i) => `<span id="${id}-n${i}" style="opacity:0">${i + 1} da prendere in carico</span>`).join('')}</span></span>
          </div>
          <ul id="${id}-list" class="lead-elenco">${li}
          </ul>
        </div>
        <div class="${id}-lab" id="${id}-lab0" style="--stem:16px">Da dove arriva</div>
        <div class="${id}-lab" id="${id}-lab1" style="--stem:58px">Cosa ha chiesto</div>
      </div>
      ${c.html}
  `;
  const script =
    runtime(id) +
    `
    const pa = W('#${id}-r0 .tag-provenienza', 0.5, 1), pb = W('#${id}-r0 .tag-richiesta', 0.5, 1);
    sceneInOut(${dur}, 0.35, 0.4);
    centerOn('#${id}-frag', 2.2);
    tl.fromTo('#${id}-frag', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
    ${righe
      .map(
        (r, i) => `
    tl.fromTo('#${id}-r${i}', { opacity: 0, y: 18, filter: 'blur(5px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'power3.out' }, ${arrivi[i]});
    tl.fromTo('#${id}-r${i}', { backgroundColor: 'rgba(200,153,31,0)' }, { backgroundColor: 'rgba(200,153,31,0.16)', duration: 0.3 }, ${arrivi[i]});
    tl.to('#${id}-r${i}', { backgroundColor: 'rgba(200,153,31,0)', opacity: ${i === righe.length - 1 ? 1 : 0.5}, duration: 0.5 }, ${(i < righe.length - 1 ? arrivi[i + 1] - 0.05 : T_OUT - 0.3).toFixed(2)});
    tl.fromTo('#${id}-n${i}', { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${arrivi[i] + 0.1});
    ${i > 0 ? `tl.to('#${id}-n${i - 1}', { opacity: 0, duration: 0.15 }, ${arrivi[i] + 0.05});` : ''}`
      )
      .join('')}
    // Chiusa: restano solo la prima riga e le due etichette dei suoi attributi.
    tl.to(['#${id}-r1', '#${id}-r2', '#${id}-r3', '#${id}-r4'], { opacity: 0, duration: 0.45, ease: 'power2.in' }, ${(T_OUT - 0.2).toFixed(2)});
    tl.to('#${id}-r0', { opacity: 1, backgroundColor: 'rgba(200,153,31,0.12)', duration: 0.4 }, ${(T_OUT - 0.2).toFixed(2)});
    gsap.set('#${id}-lab0', { x: pa.x - 66, y: pa.y + 16 });
    gsap.set('#${id}-lab1', { x: pb.x - 66, y: pb.y + 58 });
    tl.fromTo('#${id}-lab0', { opacity: 0, y: pa.y + 26 }, { opacity: 1, y: pa.y + 16, duration: 0.4, ease: 'power3.out' }, ${(T_OUT + 0.4).toFixed(2)});
    tl.fromTo('#${id}-lab1', { opacity: 0, y: pb.y + 68 }, { opacity: 1, y: pb.y + 58, duration: 0.4, ease: 'power3.out' }, ${(T_OUT + 1.3).toFixed(2)});
    ${c.js}
  `;
  const sfx = arrivi.map((a, i) => ({ t: a + 0.05, f: i % 2 ? 'interface/drop_002.ogg' : 'interface/drop_001.ogg', v: 0.45 }));
  return { id, dur, css, body, script, chapter: { n: '1', t: 'Da dove arrivano' }, sfx };
}
