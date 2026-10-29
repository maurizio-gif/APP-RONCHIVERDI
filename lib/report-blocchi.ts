import {
  SEZIONI_REPORT,
  dataEstesa,
  euroInteroIt,
  euroIt,
  meseEstesoBreve,
  numeroIt,
  testoVariazione,
  type Confronto,
  type ReportDati,
  type VoceReport,
} from '@/lib/report'

// Il contenuto del report come lista di blocchi, senza nessuna grafica:
// titoli, numeri in evidenza, tabelle, barre, colonne e note. L'anteprima a
// schermo (app/dashboard/report) e il PDF (lib/report-pdf.ts) disegnano la
// stessa lista, quindi non possono dire cose diverse.

export type ColoreBlocco = 'oro' | 'blu' | 'verde' | 'rosso'

export type NumeroBlocco = {
  etichetta: string
  valore: string
  /** Il confronto col periodo precedente: il disegno ne ricava il testo e il colore. */
  confronto?: Confronto
  /** Per uscite, ingressi negati, scaduti: un calo è la notizia buona. */
  buonoSeCala?: boolean
  /** Una riga di dettaglio al posto del confronto. */
  sotto?: string
}

export type Blocco =
  | { tipo: 'sezione'; titolo: string; nota?: string }
  | { tipo: 'sottotitolo'; testo: string }
  | { tipo: 'numeri'; voci: NumeroBlocco[] }
  | {
      tipo: 'tabella'
      colonne: { titolo: string; larghezza: number; destra?: boolean }[]
      righe: string[][]
      totale?: string[]
    }
  | { tipo: 'barre'; voci: VoceReport[]; formato: 'numero' | 'euro'; colore: ColoreBlocco }
  | { tipo: 'colonne'; etichette: string[]; serie: { nome: string; valori: number[]; colore: ColoreBlocco }[] }
  | { tipo: 'nota'; testo: string }

/** Il testo del confronto sotto un numero: «+12% (prima 1.320)». */
export function testoConfronto(c: Confronto): string {
  if (c.precedente === null) return 'nessun confronto'
  if (c.precedente <= 0) return `prima: ${numeroIt(c.precedente)}`
  return `${testoVariazione(c)} (prima ${numeroIt(c.precedente)})`
}

/** Il confronto è buono, cattivo o neutro (periodo prima a zero, nessuna variazione). */
export function esitoConfronto(c: Confronto, buonoSeCala = false): 'buono' | 'cattivo' | 'neutro' {
  if (c.precedente === null || c.precedente <= 0) return 'neutro'
  const delta = c.attuale - c.precedente
  if (delta === 0) return 'neutro'
  return delta > 0 !== buonoSeCala ? 'buono' : 'cattivo'
}

const euro = (n: number) => euroInteroIt(n)
const con = (n: number) => `${n > 0 ? '+' : ''}${numeroIt(n)}`
const percentuale = (n: number) => `${n.toString().replace('.', ',')}%`

// ─────────────────────────────────────────────────────────────── sezioni

function sintesi(r: ReportDati): Blocco[] {
  const voci: NumeroBlocco[] = []
  if (r.lead) voci.push({ etichetta: 'Lead ricevuti', valore: numeroIt(r.lead.richieste.attuale), confronto: r.lead.richieste })
  if (r.iscritti) {
    voci.push({ etichetta: 'Nuove iscrizioni', valore: numeroIt(r.iscritti.nuove.attuale), confronto: r.iscritti.nuove })
    voci.push({ etichetta: 'Rinnovi', valore: numeroIt(r.iscritti.rinnovi.attuale), confronto: r.iscritti.rinnovi })
  }
  if (r.soci) {
    voci.push({
      etichetta: 'Soci a fine periodo',
      valore: numeroIt(r.soci.fine.totale),
      confronto: { attuale: r.soci.fine.totale, precedente: r.soci.inizio.totale },
    })
  }
  if (r.scaduti) voci.push({ etichetta: 'Scaduti', valore: numeroIt(r.scaduti.scaduti.attuale), confronto: r.scaduti.scaduti, buonoSeCala: true })
  if (r.incassi) voci.push({ etichetta: 'Incassato netto', valore: euro(r.incassi.netto.attuale), confronto: r.incassi.netto })
  if (r.accessi) voci.push({ etichetta: 'Visite in sede', valore: numeroIt(r.accessi.visite.attuale), confronto: r.accessi.visite })
  if (voci.length === 0) return []
  const blocchi: Blocco[] = [{ tipo: 'sezione', titolo: 'Sintesi' }]
  for (let i = 0; i < voci.length; i += 4) blocchi.push({ tipo: 'numeri', voci: voci.slice(i, i + 4) })
  return blocchi
}

function lead(r: ReportDati): Blocco[] {
  const l = r.lead
  if (!l) return []
  const blocchi: Blocco[] = [
    { tipo: 'sezione', titolo: 'Lead', nota: 'Le richieste arrivate al CRM (sito, walk-in, telefono, eventi) e come sono andate le trattative.' },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: 'Lead ricevuti', valore: numeroIt(l.richieste.attuale), confronto: l.richieste },
        {
          etichetta: 'Lavorati',
          valore: numeroIt(l.lavorate),
          sotto: l.richieste.attuale ? `${Math.round((l.lavorate / l.richieste.attuale) * 100)}% dei ricevuti` : undefined,
        },
        { etichetta: 'Con appuntamento', valore: numeroIt(l.conAppuntamento) },
        { etichetta: 'Persone nuove in anagrafica', valore: numeroIt(l.personeNuove) },
      ],
    },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: 'Trattative aperte', valore: numeroIt(l.trattative.aperte) },
        { etichetta: 'Trattative vinte', valore: numeroIt(l.trattative.vinte) },
        { etichetta: 'Trattative perse', valore: numeroIt(l.trattative.perse) },
      ],
    },
    { tipo: 'sottotitolo', testo: 'Tipologia di lead: da dove arrivano' },
    { tipo: 'barre', voci: l.perProvenienza, formato: 'numero', colore: 'oro' },
    { tipo: 'sottotitolo', testo: 'Canale di acquisizione' },
    { tipo: 'barre', voci: l.perCanale, formato: 'numero', colore: 'blu' },
    { tipo: 'sottotitolo', testo: 'Cosa chiedono' },
    { tipo: 'barre', voci: l.perInteresse, formato: 'numero', colore: 'oro' },
  ]
  if (l.datiDal && r.periodo.dal < l.datiDal) {
    blocchi.push({ tipo: 'nota', testo: `Il CRM raccoglie le richieste dal ${dataEstesa(l.datiDal)}: prima di quella data non ci sono lead registrati.` })
  }
  return blocchi
}

function iscritti(r: ReportDati): Blocco[] {
  const i = r.iscritti
  if (!i) return []
  const blocchi: Blocco[] = [
    { tipo: 'sezione', titolo: 'Iscritti', nota: 'Abbonamenti venduti nel periodo, divisi fra nuove iscrizioni e rinnovi. Fatturato = importo delle vendite.' },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: 'Nuove iscrizioni', valore: numeroIt(i.nuove.attuale), confronto: i.nuove },
        { etichetta: 'Rinnovi', valore: numeroIt(i.rinnovi.attuale), confronto: i.rinnovi },
        { etichetta: 'Fatturato nuove', valore: euro(i.fatturatoNuove.attuale), confronto: i.fatturatoNuove },
        { etichetta: 'Fatturato rinnovi', valore: euro(i.fatturatoRinnovi.attuale), confronto: i.fatturatoRinnovi },
      ],
    },
    { tipo: 'sottotitolo', testo: 'Per gruppo di prodotti' },
    {
      tipo: 'tabella',
      colonne: [
        { titolo: 'Gruppo', larghezza: 200 },
        { titolo: 'Nuove', larghezza: 70, destra: true },
        { titolo: 'Rinnovi', larghezza: 70, destra: true },
        { titolo: 'Totale', larghezza: 70, destra: true },
        { titolo: 'Fatturato', larghezza: 100, destra: true },
      ],
      righe: i.perGruppo.map((g) => [g.gruppo, numeroIt(g.nuove), numeroIt(g.rinnovi), numeroIt(g.nuove + g.rinnovi), euro(g.fatturato)]),
      totale: [
        'Totale',
        numeroIt(i.nuove.attuale),
        numeroIt(i.rinnovi.attuale),
        numeroIt(i.nuove.attuale + i.rinnovi.attuale),
        euro(i.fatturatoNuove.attuale + i.fatturatoRinnovi.attuale),
      ],
    },
  ]
  if (i.perMese.length > 1) {
    blocchi.push(
      { tipo: 'sottotitolo', testo: 'Per mese' },
      {
        tipo: 'colonne',
        etichette: i.perMese.map((m) => meseEstesoBreve(m.mese)),
        serie: [
          { nome: 'Nuove iscrizioni', valori: i.perMese.map((m) => m.nuove), colore: 'oro' },
          { nome: 'Rinnovi', valori: i.perMese.map((m) => m.rinnovi), colore: 'blu' },
        ],
      }
    )
  }
  return blocchi
}

function soci(r: ReportDati): Blocco[] {
  const s = r.soci
  if (!s) return []
  const variazione = s.fine.totale - s.inizio.totale
  return [
    { tipo: 'sezione', titolo: 'Numero soci', nota: 'Abbonamenti in corso (non scaduti) a inizio e a fine periodo, come nella Dashboard direzionale.' },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: `Soci al ${dataEstesa(s.inizio.data)}`, valore: numeroIt(s.inizio.totale) },
        { etichetta: `Soci al ${dataEstesa(s.fine.data)}`, valore: numeroIt(s.fine.totale) },
        {
          etichetta: 'Variazione',
          valore: con(variazione),
          sotto: s.inizio.totale > 0 ? `${testoVariazione({ attuale: s.fine.totale, precedente: s.inizio.totale })} sull'inizio` : undefined,
        },
      ],
    },
    { tipo: 'sottotitolo', testo: 'Per gruppo di prodotti' },
    {
      tipo: 'tabella',
      colonne: [
        { titolo: 'Gruppo', larghezza: 230 },
        { titolo: 'A inizio periodo', larghezza: 100, destra: true },
        { titolo: 'A fine periodo', larghezza: 100, destra: true },
        { titolo: 'Variazione', larghezza: 90, destra: true },
      ],
      righe: s.perGruppo.map((g) => [g.gruppo, numeroIt(g.inizio), numeroIt(g.fine), con(g.fine - g.inizio)]),
      totale: ['Totale', numeroIt(s.inizio.totale), numeroIt(s.fine.totale), con(variazione)],
    },
  ]
}

function scaduti(r: ReportDati): Blocco[] {
  const s = r.scaduti
  if (!s) return []
  const blocchi: Blocco[] = [
    { tipo: 'sezione', titolo: 'Scaduti', nota: 'Abbonamenti con scadenza nel periodo e quanti sono stati rinnovati (stessa regola della pagina Scadenze).' },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: 'Scaduti', valore: numeroIt(s.scaduti.attuale), confronto: s.scaduti, buonoSeCala: true },
        { etichetta: 'Rinnovati', valore: numeroIt(s.rinnovati.attuale), confronto: s.rinnovati },
        {
          etichetta: 'Tasso di rinnovo',
          valore: percentuale(s.tasso.attuale),
          sotto: s.tasso.precedente !== null ? `prima ${percentuale(s.tasso.precedente)}` : undefined,
        },
        { etichetta: 'Valore non rinnovato', valore: euro(s.valoreNonRinnovato.attuale), confronto: s.valoreNonRinnovato, buonoSeCala: true },
      ],
    },
    { tipo: 'sottotitolo', testo: 'Per gruppo di prodotti' },
    {
      tipo: 'tabella',
      colonne: [
        { titolo: 'Gruppo', larghezza: 230 },
        { titolo: 'Scaduti', larghezza: 80, destra: true },
        { titolo: 'Rinnovati', larghezza: 80, destra: true },
        { titolo: 'Non rinnovati', larghezza: 90, destra: true },
        { titolo: 'Tasso', larghezza: 60, destra: true },
      ],
      righe: s.perGruppo.map((g) => [
        g.gruppo,
        numeroIt(g.scaduti),
        numeroIt(g.rinnovati),
        numeroIt(g.scaduti - g.rinnovati),
        g.scaduti ? `${Math.round((g.rinnovati / g.scaduti) * 100)}%` : '-',
      ]),
    },
  ]
  if (s.perMese.length > 1) {
    blocchi.push(
      { tipo: 'sottotitolo', testo: 'Per mese di scadenza' },
      {
        tipo: 'colonne',
        etichette: s.perMese.map((m) => meseEstesoBreve(m.mese)),
        serie: [
          { nome: 'Rinnovati', valori: s.perMese.map((m) => m.rinnovati), colore: 'verde' },
          { nome: 'Non rinnovati', valori: s.perMese.map((m) => m.scaduti - m.rinnovati), colore: 'rosso' },
        ],
      }
    )
  }
  blocchi.push({ tipo: 'nota', testo: 'Le scadenze più recenti possono ancora essere rinnovate: il tasso del periodo in corso può salire.' })
  return blocchi
}

function incassi(r: ReportDati): Blocco[] {
  const i = r.incassi
  if (!i) return []
  const blocchi: Blocco[] = [
    { tipo: 'sezione', titolo: 'Incassi', nota: "L'incassato (movimenti di cassa di Info4U) del periodo, al netto delle uscite: stessi numeri della pagina Incassato." },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: 'Incassato netto', valore: euroIt(i.netto.attuale), confronto: i.netto },
        { etichetta: 'Entrate', valore: euroIt(i.entrate.attuale), confronto: i.entrate },
        { etichetta: 'Uscite', valore: euroIt(i.uscite.attuale), confronto: i.uscite, buonoSeCala: true },
        { etichetta: 'Di cui abbonamenti', valore: euroIt(i.abbonamenti.attuale), confronto: i.abbonamenti },
      ],
    },
    { tipo: 'sottotitolo', testo: 'Per metodo di pagamento' },
    { tipo: 'barre', voci: i.perMetodo.map((m) => ({ etichetta: m.metodo, valore: m.netto })), formato: 'euro', colore: 'oro' },
    { tipo: 'sottotitolo', testo: 'Per tipo di servizio' },
    {
      tipo: 'tabella',
      colonne: [
        { titolo: 'Tipo', larghezza: 250 },
        { titolo: 'Movimenti', larghezza: 90, destra: true },
        { titolo: 'Netto', larghezza: 120, destra: true },
      ],
      righe: i.perTipo.map((t) => [t.tipo, numeroIt(t.movimenti), euroIt(t.netto)]),
      totale: ['Totale', numeroIt(i.perTipo.reduce((s, t) => s + t.movimenti, 0)), euroIt(i.netto.attuale)],
    },
  ]
  if (i.perMese.length > 1) {
    blocchi.push(
      { tipo: 'sottotitolo', testo: 'Per mese' },
      {
        tipo: 'colonne',
        etichette: i.perMese.map((m) => meseEstesoBreve(m.mese)),
        serie: [{ nome: 'Incassato netto', valori: i.perMese.map((m) => Math.max(m.netto, 0)), colore: 'oro' }],
      }
    )
  }
  return blocchi
}

function accessi(r: ReportDati): Blocco[] {
  const a = r.accessi
  if (!a) return []
  const blocchi: Blocco[] = [
    {
      tipo: 'sezione',
      titolo: 'Accessi',
      nota: 'Gli ingressi al club dai varchi. Una visita è un ingresso al giorno per persona; un passaggio è ogni apertura di un varco.',
    },
    {
      tipo: 'numeri',
      voci: [
        { etichetta: 'Visite', valore: numeroIt(a.visite.attuale), confronto: a.visite },
        { etichetta: 'Persone diverse', valore: numeroIt(a.persone.attuale), confronto: a.persone },
        { etichetta: 'Passaggi ai varchi', valore: numeroIt(a.passaggi.attuale), confronto: a.passaggi },
        { etichetta: 'Ingressi negati', valore: numeroIt(a.negati.attuale), confronto: a.negati, buonoSeCala: true },
      ],
    },
  ]
  if (a.oraDiPunta) {
    blocchi.push({
      tipo: 'nota',
      testo: `Ora di punta: ${a.oraDiPunta.giorno} alle ${String(a.oraDiPunta.ora).padStart(2, '0')}:00, in media ${Math.round(a.oraDiPunta.media)} passaggi in quell'ora.`,
    })
  }
  if (a.perPeriodo.length > 1) {
    blocchi.push(
      { tipo: 'sottotitolo', testo: a.passo === 'day' ? 'Visite per giorno' : 'Visite per mese' },
      {
        tipo: 'colonne',
        etichette: a.perPeriodo.map((p) => (a.passo === 'day' ? p.periodo.slice(8, 10) : meseEstesoBreve(p.periodo))),
        serie: [{ nome: 'Visite', valori: a.perPeriodo.map((p) => p.visite), colore: 'oro' }],
      }
    )
  }
  blocchi.push(
    { tipo: 'sottotitolo', testo: 'Passaggi per gruppo di varchi' },
    { tipo: 'barre', voci: a.perGruppo.map((g) => ({ etichetta: g.gruppo, valore: g.passaggi })), formato: 'numero', colore: 'oro' },
    { tipo: 'sottotitolo', testo: 'Passaggi per varco' },
    {
      tipo: 'tabella',
      colonne: [
        { titolo: 'Varco', larghezza: 230 },
        { titolo: 'Gruppo', larghezza: 150 },
        { titolo: 'Passaggi', larghezza: 90, destra: true },
      ],
      righe: a.perVarco.map((v) => [v.varco, v.gruppo ?? '-', numeroIt(v.passaggi)]),
    },
    { tipo: 'nota', testo: 'Info4U non distingue entrate e uscite: «ingresso» e «uscita» del tornello sono entrambi passaggi.' }
  )
  return blocchi
}

/** Tutto il report come blocchi: la sintesi e le sezioni scelte, nell'ordine del menu. */
export function costruisciBlocchi(r: ReportDati): Blocco[] {
  const per: Record<string, (r: ReportDati) => Blocco[]> = { lead, iscritti, soci, scaduti, incassi, accessi }
  const blocchi = sintesi(r)
  for (const { chiave } of SEZIONI_REPORT) {
    if (r.sezioni.includes(chiave) && !r.nonConsentite.includes(chiave)) blocchi.push(...per[chiave](r))
  }
  if (r.nonConsentite.length > 0) {
    const nomi = SEZIONI_REPORT.filter((s) => r.nonConsentite.includes(s.chiave)).map((s) => s.etichetta)
    blocchi.push({ tipo: 'nota', testo: `Non incluse per i permessi di chi ha generato il report: ${nomi.join(', ')}.` })
  }
  return blocchi
}
