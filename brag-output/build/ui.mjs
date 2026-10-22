// Mattoncini di interfaccia: stesso markup e stesse classi dell'app (components/*.tsx, app/dashboard/*.tsx), dati fittizi.
import { esc } from './lib.mjs';

export const PROV = {
  sito: ['da-sito', 'Sito web'],
  banco: ['da-banco', 'Walk-in'],
  evento: ['da-evento', 'Evento'],
  telefono: ['da-telefono', 'Phone In / Email In'],
  agenda: ['da-agenda', 'Creata in agenda'],
};
export const RICH = {
  richiamami: ['richiesta-richiamami', 'Richiamami · Sera 17–20'],
  tour: ['richiesta-tour', 'Tour in sede'],
  in_sede: ['richiesta-in-sede', 'In sede'],
  telefonata: ['richiesta-telefonata', 'Telefonata'],
  email: ['richiesta-email', 'Email'],
};
export const TIPO = {
  sede: ['tipo-sede', 'In sede'],
  telefono: ['tipo-telefono', 'Telefonata'],
  task: ['tipo-task', 'Task'],
  email: ['tipo-email', 'Email'],
  whatsapp: ['tipo-whatsapp', 'WhatsApp'],
  messaggio: ['tipo-messaggio', 'Messaggio'],
};

export const tagProv = (k) => `<span class="tag-provenienza ${PROV[k][0]}">${PROV[k][1]}</span>`;
export const tagRich = (k, testo) => `<span class="tag-richiesta ${RICH[k][0]}">${testo ?? RICH[k][1]}</span>`;
export const badgeTipo = (k) => `<span class="badge badge-tipo ${TIPO[k][0]}">${TIPO[k][1]}</span>`;

/** Una striscia di lead come in ElencoLead (solo la parte di testo, senza tendine). */
export function leadTesto({ nome, prov, rich, richTesto, tipo, attesa = 'aperta oggi', attesaCls = 'attesa-oggi', dett }) {
  return `<div class="lead-testo">
        <div class="azione-titolo">
          <span class="azione-nome">${esc(nome)}</span>
          ${prov ? tagProv(prov) : ''}
          ${rich ? tagRich(rich, richTesto) : ''}
          ${tipo ? `<span class="badge-tipo ${TIPO[tipo][0]}">${TIPO[tipo][1]}</span>` : ''}
          ${attesa ? `<span class="attesa ${attesaCls}">${attesa}</span>` : ''}
        </div>
        ${dett ? `<div class="azione-dettaglio muted">${esc(dett)}</div>` : ''}
      </div>`;
}

/** Il blocco comandi di un lead: «In carico a» e «Stato». */
export function comandiLead({ inCarico = 'Nessuno', stato = 'Da prendere in carico', idIn = '', idSt = '' }) {
  return `<div class="lead-comandi">
        <select aria-label="In carico a" ${idIn ? `id="${idIn}"` : ''}><option>${inCarico}</option></select>
        <select aria-label="Stato" ${idSt ? `id="${idSt}"` : ''}><option>${stato}</option></select>
      </div>`;
}

export const chip = (testo, n, { attivo = false, id = '' } = {}) =>
  `<span ${id ? `id="${id}"` : ''} class="chip${attivo ? ' is-attivo' : ''}${n === 0 ? ' is-zero' : ''}">${attivo ? '<span class="chip-spunta" aria-hidden="true">✓</span>' : ''}${testo}${n != null ? `<span class="chip-conteggio">${n}</span>` : ''}</span>`;

/** Il bottone base dell'app. */
export const btn = (testo, { ghost = false, sm = true, id = '', extra = '' } = {}) =>
  `<button type="button" ${id ? `id="${id}"` : ''} class="btn${ghost ? ' btn-ghost' : ''}${sm ? ' btn-sm' : ''}" ${extra}>${testo}</button>`;

/** Il riquadro «Nuova trattativa da prendere in carico» (AvvisoOpportunita.tsx). */
export function avviso({ id, nome, sezione, recapiti, messaggio, pos = 'right:20px;bottom:20px' }) {
  return `<div class="avviso-opportunita" id="${id}" role="alert" style="position:absolute;${pos}">
      <div class="avviso-testa">
        <p class="eyebrow">Nuova trattativa da prendere in carico</p>
        <button type="button" class="avviso-chiudi" aria-label="Chiudi l'avviso">×</button>
      </div>
      <p class="avviso-nome">${esc(nome)}</p>
      <p class="avviso-sezione">${esc(sezione)}</p>
      <p class="muted avviso-recapiti">${esc(recapiti)}</p>
      <p class="avviso-messaggio" id="${id}-msg">${esc(messaggio)}</p>
      <div class="avviso-azioni">
        <button type="button" class="btn btn-sm" id="${id}-prendi">Prendi in carico</button>
        <a class="btn btn-ghost btn-sm" id="${id}-scheda">Apri la scheda <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>
      </div>
      <div class="avviso-suono"><label><input type="checkbox" checked /> Avviso sonoro su questo browser</label><button type="button" class="btn-prova-suono">prova</button></div>
    </div>`;
}

/** Una riga d'azione come in AzioniVeloci (conScheda = elenco: «Apri scheda ↗»; senza = scheda: nota + esiti). */
export function azioneRiga({ tipo, quando, nome, tel, chi, dett, arretrata = false, badge = '', id = '', conScheda = true, nota = false, esiti = null, fatta = false }) {
  return `<li class="azione-riga${arretrata ? ' is-arretrata' : ''}${fatta ? ' is-fatta' : ''}" ${id ? `id="${id}"` : ''}>
        <div class="azione-testo">
          <div class="azione-titolo">
            <span class="badge badge-tipo ${TIPO[tipo][0]}">${TIPO[tipo][1]}</span>
            <span class="azione-quando">${quando}</span>
            ${conScheda && nome ? `<span class="azione-nome">${esc(nome)}</span>` : ''}
            ${conScheda && tel ? `<a class="azione-tel">${tel}</a>` : ''}
            ${chi ? `<span class="muted azione-chi">· ${esc(chi)}</span>` : ''}
            ${badge}
          </div>
          ${dett ? `<div class="azione-dettaglio muted">${esc(dett)}</div>` : ''}
        </div>
        ${conScheda ? '<a class="btn btn-ghost btn-sm">Apri scheda ↗</a>' : esiti ?? ''}
      </li>`;
}

/** Il blocco «Trattativa» (richieste/Trattativa.tsx): stato, passi, chi la segue. */
export function trattativa({ id, stato = 'nuovo', chi = 'nessun assegnatario', azione, conPrendi = true }) {
  const mappa = {
    nuovo: ['stato-nuovo', 'badge-warn', 'Da prendere in carico', 0],
    in_gestione: ['stato-gestione', 'badge-info', 'In gestione', 1],
    vinto: ['stato-vinto', 'badge-ok', 'Vinta', 2],
  };
  const [cls, bcls, et, passo] = mappa[stato];
  return `<div class="trattativa ${cls}" id="${id}">
      <div class="trattativa-testa">
        <span class="trattativa-etichetta">Trattativa</span>
        <span class="badge badge-stato badge-punto ${bcls}" id="${id}-badge">${et}</span>
        <span class="pipeline-passi" role="img">${[0, 1, 2].map((i) => `<span class="pipeline-passo${i < passo ? ' is-fatto' : ''}${i === passo ? ' is-adesso' : ''}"></span>`).join('')}</span>
      </div>
      <div class="trattativa-corpo">
        <div class="trattativa-riga">
          <span class="trattativa-chi muted" id="${id}-chi">${chi}</span>
          ${conPrendi ? `<button type="button" class="btn btn-sm" id="${id}-prendi">Prendi in carico</button>` : ''}
        </div>
        <p class="trattativa-azione" id="${id}-az">${azione}</p>
      </div>
    </div>`;
}

export const pageHead = (eyebrow, h1) => `<div class="page-head"><p class="eyebrow">${eyebrow}</p><h1>${h1}</h1></div>`;

// ─────────────────────────────────────────────────────────── il menu laterale
const ICO = {
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 10v11M15 10v11"/>',
  persone: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.7 3.1-6.2 7-6.2s7 2.5 7 6.2"/>',
  club: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/>',
  phone: '<path d="M4 5c0 8.5 6.5 15 15 15l2-4-5-2-1.5 1.5A11.6 11.6 0 0 1 9 10.5L10.5 9 8.5 4 4 5z"/>',
  rinnovi: '<path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4M5.5 3v4h4M18.5 21v-4h-4"/>',
};
const ico = (k) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="nav-icona">${ICO[k]}</svg>`;
export const navItem = (k, label, { attivo = false, id = '' } = {}) => `<a class="nav-item${attivo ? ' is-active' : ''}" ${id ? `id="${id}"` : ''}>${ico(k)}${label}</a>`;

/** La sidebar scura (Sidebar.tsx): gruppo «Core New» e, sotto, la «Segreteria». */
export function sidebar({ id, attivo = 'agenda', altezza = 760 }) {
  return `<aside class="sidebar" id="${id}" style="width:260px;height:${altezza}px">
      <div class="sidebar-brand">
        <img src="assets/img/logo-crema.png" alt="Ronchiverdi" class="brand-logo" style="filter:none;opacity:.92" />
        <div class="user-row"><span class="user-badge" aria-hidden="true">EB</span><span class="user-meta"><span class="user-name">Elena B.</span><span class="user-email">elena@example.it</span></span></div>
      </div>
      <nav class="nav">
        <div class="nav-gruppo"><p class="nav-gruppo-label">Core New</p>
          ${navItem('dashboard', 'Dashboard New', { attivo: attivo === 'dashboard', id: id + '-n-dash' })}
          ${navItem('agenda', 'Agenda', { attivo: attivo === 'agenda', id: id + '-n-agenda' })}
          ${navItem('persone', 'Contatti', { attivo: attivo === 'persone', id: id + '-n-contatti' })}
        </div>
        <div class="nav-gruppo"><p class="nav-gruppo-label">Segreteria</p>
          ${navItem('club', 'Eventi Core')}
          ${navItem('phone', 'Phone In / Email In', { id: id + '-n-phone' })}
          ${navItem('rinnovi', 'Rinnovi Core')}
        </div>
      </nav>
    </aside>`;
}

// ───────────────────────────────────────────────────────────── il calendario
const HH = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const MIN = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const INI = 13, FIN = 19, ORA_PX = 58;
export const COL_OP = { elena: '#8b6c14', marco: '#35566b', sofia: '#6e3f6a', senza: '#7a776b' };
const SEGNO = { dafare: '', ritardo: '!', fatto: '✓' };
const NOME_STATO = { dafare: 'Da fare', ritardo: 'In ritardo · esito da registrare', fatto: 'Fatta' };

/** Un evento sulla griglia (stessa geometria di GrigliaAgenda: top/height dai minuti, ritardo ≥ 52 px). */
export function evento({ id = '', ora, dur, nome, canale, stato, dett = '', esito = '', col = 0, n = 1, sel = false }) {
  const inizio = MIN(ora);
  const alto = Math.max((dur / 60) * ORA_PX - 3, 24);
  const breve = alto < 40;
  const h = stato === 'ritardo' && !breve ? Math.max(alto, 52) : alto;
  const w = 100 / n;
  const top = ((inizio - INI * 60) / 60) * ORA_PX + 1;
  const sotto = breve
    ? ''
    : stato === 'fatto'
      ? `<div class="agt-ev-s"><b>${canale}</b> · ✓ ${esito || 'Eseguita'}</div>`
      : `<div class="agt-ev-s"><b>${canale}</b> · ${ora}–${HH(inizio + dur)}${dett ? ` · ${dett}` : ''}</div>`;
  return `<button type="button" ${id ? `id="${id}"` : ''} class="agt-ev agt-${stato}${sel ? ' agt-sel' : ''}" style="top:${top}px;height:${h}px;left:calc(${col * w}% + 3px);width:calc(${w}% - 6px)" title="${canale} · ${NOME_STATO[stato]}">
              <div class="agt-ev-t"><span class="agt-segno">${SEGNO[stato]}</span><span class="agt-ev-nome">${breve ? ora + ' · ' : ''}${esc(nome)}</span></div>
              ${sotto}
              ${stato === 'ritardo' && !breve ? '<span class="agt-targa">Esito da registrare</span>' : ''}
            </button>`;
}
export const chipGiornata = ({ id = '', nome, fascia, stato = 'dafare' }) =>
  `<button type="button" ${id ? `id="${id}"` : ''} class="agt-chip agt-${stato}"><span class="agt-segno">${SEGNO[stato]}</span><b>${esc(nome)}</b><span class="agt-fascia"><b>Richiamami</b> · ${fascia}</span></button>`;

/** Il mini-mese di ottobre 2026 (il 1° è giovedì → 3 giorni di settembre prima). */
function miniMese(oggi = 22, conVoci = [19, 20, 21, 22, 23, 24, 26, 27, 28]) {
  const celle = [];
  for (let i = 0; i < 42; i++) {
    const g = i - 3 + 1; // giorno del mese per la cella i
    let n, fuori = false;
    if (g < 1) { n = 30 + g; fuori = true; } else if (g > 31) { n = g - 31; fuori = true; } else n = g;
    const cls = [fuori ? 'fuori' : '', !fuori && conVoci.includes(n) ? 'ha' : '', !fuori && n === oggi ? 'oggi sel' : ''].join(' ').trim();
    celle.push(`<button type="button" class="${cls}">${n}</button>`);
  }
  return `<div class="agt-pannello" id="__ID__-mese">
        <div class="agt-mese-testa"><button type="button">‹</button><span>Ottobre 2026</span><button type="button">›</button></div>
        <div class="agt-mese">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d) => `<div class="dow">${d}</div>`).join('')}${celle.join('')}</div>
      </div>`;
}

const OPERATORI = [
  { k: 'elena', nome: 'Elena B.', ini: 'EB', tu: true },
  { k: 'marco', nome: 'Marco T.', ini: 'MT' },
  { k: 'senza', nome: 'Senza assegnatario', ini: '—' },
];

/** Il calendario del giorno. `attivi` = chiavi degli operatori scelti; `dati` = {conti, legenda}. */
export function calendarioGiorno({ id, attivi = ['elena'], tutti = false, conti, eventiPer, chipPer, legenda, arretrati = 3 }) {
  const cols = OPERATORI.filter((o) => attivi.includes(o.k));
  const griglia = `var(--agt-gutter) repeat(${cols.length}, minmax(150px, 1fr))`;
  const ore = [...Array(FIN - INI)].map((_, i) => `<div>${String(INI + i).padStart(2, '0')}:00</div>`).join('');
  const nomeOp = (o) => (o.k === 'senza' ? 'Senza assegnatario' : o.nome);
  const teste = cols
    .map(
      (o) => `<div><span class="agt-iniziali" style="background:${COL_OP[o.k]}">${o.ini}</span><span class="agt-nome-col">${nomeOp(o)}${o.tu ? '<small class="agt-muted"> (tu)</small>' : ''}</span><span class="agt-conta">${conti[o.k].tot}</span></div>`
    )
    .join('');
  const giornata = cols.map((o) => `<div>${(chipPer[o.k] || []).join('')}</div>`).join('');
  const colonne = cols
    .map(
      (o, i) => `<div class="agt-colonna" style="height:${(FIN - INI) * ORA_PX}px">${(eventiPer[o.k] || []).join('')}${
        `<div class="agt-adesso${i ? ' senza-punto' : ''}" style="top:${((16 * 60 + 20 - INI * 60) / 60) * ORA_PX}px"></div>`
      }</div>`
    )
    .join('');
  const filtroOp = OPERATORI.map((o) => {
    const q = conti[o.k].dafare;
    return `<label class="agt-filtro"><input type="checkbox" ${attivi.includes(o.k) ? 'checked' : ''} /><span class="agt-iniziali agt-iniziali-sm" style="background:${COL_OP[o.k]}">${o.k === 'senza' ? '—' : o.ini}</span>${nomeOp(o)}${o.tu ? '<span class="agt-muted">&nbsp;(tu)</span>' : ''}<span class="agt-conta${o.k === 'senza' && q > 0 ? ' agt-allarme' : ''}">${q}</span></label>`;
  }).join('');
  const stati = [['dafare', 'Da fare', legenda.dafare], ['ritardo', 'In ritardo', legenda.ritardo], ['fatto', 'Fatte', legenda.fatto]]
    .map(([k, n, q]) => `<label class="agt-filtro"><input type="checkbox" checked /><i class="agt-l-segno agt-l-${k}">${SEGNO[k]}</i>${n}<span class="agt-conta">${q}</span></label>`)
    .join('');
  const tipi = [['Visita in sede', legenda.sede], ['Telefonata', legenda.tel], ['Task', 0], ['Email', 0], ['WhatsApp', 0], ['Messaggio', 0]]
    .map(([n, q]) => `<label class="agt-filtro"><input type="checkbox" checked />${n}<span class="agt-conta">${q}</span></label>`)
    .join('');
  const chi = attivi.length === OPERATORI.length ? 'Tutti gli operatori' : cols.map((o) => nomeOp(o) + (o.tu ? ' (tu)' : '')).join(', ');
  return `<div class="agt" id="${id}">
      <div class="agt-testa" id="${id}-testa">
        <h1><small>Agenda · giorno</small>Giovedì 22 ottobre</h1>
        <button type="button" class="agt-btn agt-tondo" aria-label="Indietro">‹</button>
        <button type="button" class="agt-btn" id="${id}-oggi">Oggi</button>
        <button type="button" class="agt-btn agt-tondo" aria-label="Avanti">›</button>
        <div class="agt-segmenti" id="${id}-gs"><button type="button" class="on">Giorno</button><button type="button" id="${id}-sett">Settimana</button></div>
        <a class="agt-btn agt-vista-elenco" id="${id}-elenco">☰ Vista elenco</a>
        <div class="agt-spazio"></div>
        <div class="agt-segmenti"><button type="button" class="on">Per operatore</button><button type="button">Tutti insieme</button></div>
        <input class="agt-cerca" type="search" placeholder="Cerca nome o telefono" />
      </div>
      <div class="agt-corpo">
        <aside class="agt-sx" id="${id}-sx">
          ${miniMese().replace('__ID__', id)}
          <a class="agt-arretrati" id="${id}-arretrati"><b>${arretrati}</b> azioni arretrate dai giorni scorsi <span>→</span></a>
          <div class="agt-pannello" id="${id}-op"><h3>Operatori</h3>
            <label class="agt-filtro agt-filtro-tutti" id="${id}-tutti"><input type="checkbox" ${tutti ? 'checked' : ''} /><b>Tutti</b></label>
            ${filtroOp}
          </div>
          <div class="agt-pannello" id="${id}-stato"><h3>Stato</h3>${stati}</div>
          <div class="agt-pannello"><h3>Tipi</h3>${tipi}</div>
        </aside>
        <div class="agt-destra">
          <div class="agt-legenda" id="${id}-leg">
            <span><i class="agt-l-segno agt-l-dafare"></i><b>${legenda.dafare}</b>&nbsp;da fare</span>
            <span class="agt-rosso"><i class="agt-l-segno agt-l-ritardo">!</i><b>${legenda.ritardo}</b>&nbsp;in ritardo, esito da registrare</span>
            <span class="agt-verde"><i class="agt-l-segno agt-l-fatto">✓</i><b>${legenda.fatto}</b>&nbsp;fatte</span>
            <span class="agt-chi">${chi}</span>
          </div>
          <div class="agt-cal" id="${id}-cal">
            <div class="agt-cal-teste" style="grid-template-columns:${griglia}"><div></div>${teste}</div>
            <div class="agt-giornata" style="grid-template-columns:${griglia}"><div>in<br>giornata</div>${giornata}</div>
            <div class="agt-griglia" style="grid-template-columns:${griglia}"><div class="agt-ore">${ore}</div>${colonne}</div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Gli eventi di esempio di giovedì 22 ottobre, divisi per operatore. */
export function datiGiorno(pre) {
  const e = (k, o) => evento({ id: o.id ? `${pre}-${o.id}` : '', ...o });
  const eventiPer = {
    elena: [
      evento({ id: pre + '-e-fatta', ora: '13:30', dur: 45, nome: 'Giulia Rinaldi', canale: 'Visita in sede', stato: 'fatto', esito: 'Eseguita' }),
      evento({ id: pre + '-e-ritardo', ora: '15:00', dur: 45, nome: 'Davide Sala', canale: 'Visita in sede', stato: 'ritardo', dett: 'Tour' }),
      evento({ id: pre + '-e-dafare', ora: '17:30', dur: 45, nome: 'Anna Greco', canale: 'Visita in sede', stato: 'dafare', dett: 'Tour' }),
    ],
    marco: [
      evento({ id: pre + '-m-fatta', ora: '14:00', dur: 20, nome: 'Paolo Neri', canale: 'Telefonata', stato: 'fatto' }),
      evento({ id: pre + '-m-dafare', ora: '16:00', dur: 45, nome: 'Laura Costa', canale: 'Visita in sede', stato: 'dafare', dett: 'Tour' }),
    ],
    senza: [],
  };
  const chipPer = {
    elena: [chipGiornata({ id: pre + '-chip', nome: 'Chiara Morandi', fascia: '17–20' })],
    marco: [],
    senza: [chipGiornata({ id: pre + '-chip2', nome: 'Franco Gatti', fascia: '17–20' })],
  };
  const conti = { elena: { tot: 4, dafare: 2 }, marco: { tot: 2, dafare: 1 }, senza: { tot: 1, dafare: 1 } };
  return { eventiPer, chipPer, conti };
}

/** Il pannello laterale di dettaglio (sola lettura). */
export function dettaglio({ id }) {
  return `<aside class="agt-dettaglio" id="${id}" style="position:absolute;top:0;right:0;bottom:0;transform:none;width:420px">
      <div class="agt-det-testa">
        <button type="button" class="agt-chiudi" aria-label="Chiudi">×</button>
        <span class="agt-badge">✆ Richiamami</span><span class="agt-stato-badge agt-sb-dafare">Da fare</span>
        <h2>Chiara Morandi</h2>
        <div class="agt-det-quando">Arrivata giovedì 22 ottobre · alle 15:21 · preferisce: Sera · 17–20</div>
      </div>
      <div class="agt-det-corpo">
        <p class="agt-sola-lettura">Riepilogo in sola lettura: l’azione si gestisce nella scheda.</p>
        <div class="agt-nota"><b>Il suo messaggio</b>Vorrei provare il club e capire quali abbonamenti ci sono.</div>
        <dl>
          <dt>Azione</dt><dd>Richiamami</dd>
          <dt>Cellulare</dt><dd>340 123 4567</dd>
          <dt>Email</dt><dd>chiara.morandi@example.it</dd>
          <dt>Interesse</dt><dd>Abbonamento Club e Family</dd>
          <dt>Provenienza</dt><dd>Richiesta dal sito</dd>
          <dt>Assegnata a</dt><dd>Elena B.</dd>
        </dl>
      </div>
      <div class="agt-det-piede">
        <a class="agt-gestisci" id="${id}-gestisci">Gestisci<span>Apre la scheda di Chiara Morandi in una nuova scheda ↗</span></a>
      </div>
    </aside>`;
}

/** La vista Settimana (solo testata + griglia): sette colonne, oggi evidenziato. */
export function calendarioSettimana({ id }) {
  const giorni = [['lun', 19], ['mar', 20], ['mer', 21], ['gio', 22], ['ven', 23], ['sab', 24], ['dom', 25]];
  const contaGiorno = [2, 2, 2, 5, 2, 1, 0];
  const ev = (g) => ({
    19: [['14:00', 30, 'Elisa Moro', 'fatto'], ['16:30', 30, 'Paolo Neri', 'fatto']],
    20: [['13:30', 30, 'Luigi Pace', 'fatto'], ['15:00', 30, 'Sara Villa', 'fatto']],
    21: [['14:30', 30, 'Gianni Fè', 'fatto'], ['16:00', 30, 'Marta Riva', 'ritardo']],
    22: [['13:30', 30, 'Giulia Rinaldi', 'fatto'], ['15:00', 30, 'Davide Sala', 'ritardo'], ['16:00', 30, 'Laura Costa', 'dafare'], ['17:30', 30, 'Anna Greco', 'dafare']],
    23: [['14:00', 30, 'Bruno Cai', 'dafare'], ['17:00', 30, 'Irene Lodi', 'dafare']],
    24: [['15:00', 30, 'Nicola Pini', 'dafare']],
    25: [],
  }[g]);
  const griglia = 'var(--agt-gutter) repeat(7, minmax(110px, 1fr))';
  const teste = giorni
    .map(([gs, gn], i) => `<button type="button" class="agt-testa-giorno${gn === 22 ? ' e-oggi' : ''}" id="${id}-g${gn}"><span class="gs">${gs}</span><span class="gn">${gn}</span><span class="agt-conta">${contaGiorno[i]}</span></button>`)
    .join('');
  const colonne = giorni
    .map(([, gn]) => `<div class="agt-colonna${gn === 22 ? ' agt-col-oggi' : ''}" style="height:${(FIN - INI) * ORA_PX}px">${ev(gn)
      .map(([ora, dur, nome, stato]) => evento({ ora, dur, nome, canale: 'Visita in sede', stato }))
      .join('')}</div>`)
    .join('');
  const ore = [...Array(FIN - INI)].map((_, i) => `<div>${String(INI + i).padStart(2, '0')}:00</div>`).join('');
  return `<div class="agt" id="${id}">
      <div class="agt-testa">
        <h1><small>Agenda · settimana</small>19 – 25 ottobre</h1>
        <button type="button" class="agt-btn agt-tondo">‹</button><button type="button" class="agt-btn">Oggi</button><button type="button" class="agt-btn agt-tondo">›</button>
        <div class="agt-segmenti"><button type="button">Giorno</button><button type="button" class="on">Settimana</button></div>
        <a class="agt-btn agt-vista-elenco">☰ Vista elenco</a>
      </div>
      <div class="agt-cal" id="${id}-cal">
        <div class="agt-cal-teste" style="grid-template-columns:${griglia}"><div></div>${teste}</div>
        <div class="agt-giornata" style="grid-template-columns:${griglia}"><div>in<br>giornata</div>${giorni
          .map(([, gn]) => `<div>${gn === 22 ? chipGiornata({ nome: 'Chiara Morandi', fascia: '17–20' }) : ''}</div>`)
          .join('')}</div>
        <div class="agt-griglia" style="grid-template-columns:${griglia}"><div class="agt-ore">${ore}</div>${colonne}</div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────── la scheda del contatto
/** Un campo che "si scrive": un div con lo stesso aspetto dell'input .azione-nota e testo rivelato a caratteri. */
export const campoNota = ({ id, placeholder = 'Com’è andata', larg = '17rem', testi = [] }) =>
  `<div class="azione-nota" id="${id}" style="position:relative;display:inline-block;width:${larg};height:2.1em;overflow:hidden;white-space:nowrap;vertical-align:middle">
        <span class="ph" id="${id}-ph" style="position:absolute;left:0.55rem;top:0.34rem;color:var(--text-muted)">${esc(placeholder)}</span>
        ${testi.map((t, i) => `<span id="${id}-t${i}" style="position:absolute;left:0.55rem;top:0.34rem">${typedSpans(t)}</span>`).join('')}
      </div>`;
const typedSpans = (t) => [...t].map((c) => `<span style="opacity:0">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');

export function rigaRichiamo({ id, quando = 'Sera 17–20', tent = '', note = [], tipo = 'telefono', chi = 'Elena B.', dett = 'Abbonamento Club e Family', fascia = true, noBtn = 'Non risponde, riprovo', btnLarg = '17rem' }) {
  return `<li class="azione-riga" id="${id}">
          <div class="azione-testo">
            <div class="azione-titolo">
              <span class="badge badge-tipo ${TIPO[tipo][0]}">${TIPO[tipo][1]}</span>
              <span class="azione-quando">${quando}</span>
              <span class="muted azione-chi">· ${chi}</span>
              ${fascia ? '<span class="badge badge-ok">è la sua fascia adesso</span>' : ''}
              <span class="muted" id="${id}-tent" style="${tent ? '' : 'opacity:0'}">· ${tent || '1 tentativo'}</span>
            </div>
            <div class="azione-dettaglio muted">${esc(dett)}</div>
          </div>
          <div class="azione-comandi">
            ${campoNota({ id: id + '-nota', testi: note, larg: btnLarg })}
            <button type="button" class="btn btn-sm" id="${id}-fatto">Fatto ✓</button>
            <button type="button" class="btn btn-ghost btn-sm" id="${id}-nr">${noBtn}</button>
          </div>
        </li>`;
}

const gruppo = (cls, titolo, nota, id, conto, corpo, vuoto) =>
  `<div class="azioni-gruppo ${cls}" id="${id}">
        <h3>${titolo} <span class="azioni-gruppo-conto" id="${id}-conto">${conto}</span>${nota ? `<span class="muted azioni-gruppo-nota">${nota}</span>` : ''}</h3>
        <div id="${id}-corpo">${corpo || ''}</div>
        ${vuoto ? `<p class="muted azioni-gruppo-vuoto" id="${id}-vuoto">${vuoto}</p>` : ''}
      </div>`;

export const fattaLi = ({ id = '', tipo = 'telefono', quando = 'gio 22 ott 2026', chi = 'Elena B.', esito = 'Eseguita', cls = 'badge-ok', nota }) =>
  `<li ${id ? `id="${id}"` : ''}><span class="badge-tipo ${TIPO[tipo][0]}">${TIPO[tipo][1]}</span> <span class="muted">${quando} · ${chi}</span> <span class="badge ${cls}">${esito}</span><div class="storia-testo">${esc(nota)}</div></li>`;

/** La scheda di Chiara Morandi: testata + card Lead + card Azioni (+ «Nuova azione»). Tutto parametrico. */
export function scheda({ id, comandiExtra = '', dlExtra = '', conLead = true, conAzioni = true, ora = '', oraConto = 1, oraVuoto = 'Niente da fare adesso.', prog = '', progConto = 0, fatte = '', fatteConto = 0, nuova = true, tipoNuova = 'Telefonata', btnNuova = 'Aggiungi', giornoNuova = 'gio 22 ott', oraNuova = '', chiNuova = 'Io', notaNuova = [] }) {
  const head = `<div class="page-head" style="margin-bottom:1rem">
        <p class="eyebrow"><a>← Contatti</a></p>
        <h1 style="margin-bottom:.5rem">Chiara Morandi</h1>
        <div class="agenda-nav" id="${id}-contatti"><a class="btn btn-ghost btn-sm">340 123 4567</a><a class="btn btn-ghost btn-sm">WhatsApp</a><a class="btn btn-ghost btn-sm">chiara.morandi@example.it</a></div>
      </div>`;
  const lead = conLead
    ? `<div class="card" id="${id}-lead">
        <div class="card-head"><h2>Lead</h2><span class="badge badge-stato badge-punto badge-info" id="${id}-badge">In gestione</span></div>
        <dl class="dati">
          <dt>Arrivato</dt><dd>22 ott 2026, 15:21</dd>
          <dt>Da</dt><dd id="${id}-da"><span class="tag-provenienza da-sito">Sito web</span></dd>
          <dt>Richiesta</dt><dd id="${id}-rich"><span class="tag-richiesta richiesta-richiamami">Richiamami · Sera 17–20</span></dd>
          <dt>Interesse</dt><dd>Abbonamento Club e Family</dd>
          <dt>Messaggio</dt><dd id="${id}-msg">Vorrei provare il club e capire quali abbonamenti ci sono.</dd>
          ${dlExtra}
        </dl>
        <div class="scheda-comandi" id="${id}-cmd"><span class="muted">In carico a · stato</span>
          <div class="lead-comandi"><select aria-label="In carico a"><option>Io</option></select><select aria-label="Stato" id="${id}-stato"><option>In gestione</option></select>${comandiExtra}</div>
        </div>
      </div>`
    : '';
  const azioni = conAzioni
    ? `<div class="card" id="${id}-azioni">
        <div class="card-head"><h2>Azioni</h2></div>
        ${gruppo('azioni-gruppo-ora', 'Da fare ora', 'oggi o scadute', id + '-ora', oraConto, ora ? `<ul class="azioni-elenco">${ora}</ul>` : '', oraConto ? '' : oraVuoto)}
        ${gruppo('azioni-gruppo-future', 'In programma', 'nei prossimi giorni', id + '-prog', progConto, prog ? `<ul class="azioni-elenco">${prog}</ul>` : '', progConto ? '' : 'Nessuna azione in programma.')}
        ${gruppo('azioni-gruppo-fatte', 'Fatte', '', id + '-fatte', fatteConto, fatte ? `<ol class="storia">${fatte}</ol>` : '', fatteConto ? '' : 'Nessuna azione fatta.')}
        ${nuova
          ? `<div class="nuova-azione-box" id="${id}-nuova"><h3>Nuova azione</h3>
          <div class="nuova-azione">
            <select aria-label="Tipo" id="${id}-tipo"><option>${tipoNuova}</option></select>
            <span id="${id}-giorno" style="position:relative;display:inline-block;width:7.2rem;height:2.1em;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:var(--text-xs);vertical-align:middle"><span id="${id}-giorno-a" style="position:absolute;left:0.5rem;top:0.34rem">${giornoNuova}</span><span id="${id}-giorno-b" style="position:absolute;left:0.5rem;top:0.34rem;opacity:0">sab 24 ott</span></span>
            <span id="${id}-ora-in" style="position:relative;display:inline-block;width:4.6rem;height:2.1em;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);font-size:var(--text-xs);vertical-align:middle"><span id="${id}-ora-a" style="position:absolute;left:0.5rem;top:0.34rem;color:var(--text-muted)">--:--</span><span id="${id}-ora-b" style="position:absolute;left:0.5rem;top:0.34rem;opacity:0">15:00</span></span>
            <select aria-label="A chi" id="${id}-chi"><option>${chiNuova}</option></select>
            <div class="azione-nota nuova-azione-nota" id="${id}-nnota" style="position:relative;display:inline-block;height:2.1em;overflow:hidden;white-space:nowrap;vertical-align:middle;border:1px solid var(--border);padding:0;background:var(--bg);border-radius:var(--radius)">
              <span id="${id}-nph" style="position:absolute;left:0.5rem;top:0.34rem;color:var(--text-muted)">Cosa c'è da fare</span>
              ${notaNuova.map((t, i) => `<span id="${id}-nt${i}" style="position:absolute;left:0.5rem;top:0.34rem">${typedSpans(t)}</span>`).join('')}
            </div>
            <button type="button" class="btn btn-sm" id="${id}-agg">${btnNuova}</button>
          </div></div>`
          : ''}
      </div>`
    : '';
  return `${head}${lead}${azioni}`;
}
