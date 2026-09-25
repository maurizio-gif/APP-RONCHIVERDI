// Il resoconto serale della Dashboard Direzionale: fatturato, soci attivi,
// contatti e visite di oggi, e cosa si è venduto oggi per gruppo prodotto —
// per il gruppo CORE, anche quanto di quel venduto è nuovo e quanto è un
// rinnovo. Vedi app/api/cron/report-direzionale/route.ts per lo scheduling;
// qui sta solo la lettura dei dati e la composizione dell'email, per poterla
// testare/rileggere senza la parte HTTP.

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { caricaGruppi, NON_CATEGORIZZATO, type Gruppo } from '@/lib/abbonamenti'
import { euro, testoVariazione, variazionePercentuale } from '@/lib/pipeline'
import { giornoPiu, mezzanotteRoma, stessoGiornoMesiFa } from '@/lib/agenda'
import { rangeMTD, rangeYTD, type RangePeriodo } from '@/lib/direzione'
import { provenienzaDiOrigine } from '@/lib/provenienza'

type RigaGruppo = { gruppoId: string; nome: string; vendite: number; fatturato: number }
type RigaSoci = { gruppoId: string; nome: string; oggi: number; annoScorso: number }

type ConfrontoPeriodo = { attuale: number; precedente: number }

export type ResocontoDirezionale = {
  giorno: string
  dataLeggibile: string
  fatturatoMTD: ConfrontoPeriodo
  fatturatoYTD: ConfrontoPeriodo
  sociPerGruppo: RigaSoci[]
  sociNonCategorizzato: RigaSoci | null
  sociTotale: { oggi: number; annoScorso: number }
  contattiOggi: { totale: number; web: number; walkIn: number }
  visiteSitoOggi: { sessioni: number; persone: number }
  venditeIeri: { vendite: number; fatturato: number }
  perGruppo: RigaGruppo[]
  nonCategorizzato: RigaGruppo | null
  totale: { vendite: number; fatturato: number }
  core: { nuovi: { vendite: number; fatturato: number }; rinnovi: { vendite: number; fatturato: number } } | null
}

function dataLeggibileDi(giorno: string): string {
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Il fatturato (somma di abbonamenti_giornalieri, senza filtro gruppo) su un
 * range di giorni — stessa funzione di app/dashboard/direzione/page.tsx
 * (sommaGiornalieri), qui senza il filtro multi-gruppo di quella pagina: il
 * resoconto serale è sempre il totale, non una vista filtrata.
 */
async function fatturatoDelPeriodo(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  range: RangePeriodo
): Promise<number> {
  const { data } = await supabase
    .from('abbonamenti_giornalieri')
    .select('fatturato')
    .gte('giorno', range.giornoDa)
    .lte('giorno', range.giornoA)
  return (data ?? []).reduce((tot, r) => tot + Number(r.fatturato ?? 0), 0)
}

/** Soci attivi (abbonamenti_attivi_al) per gruppo, in un giorno — gruppo_id null = non categorizzato. */
async function sociAttiviPerGruppoAl(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  giorno: string
): Promise<Map<string | null, number>> {
  const { data } = await supabase.rpc('abbonamenti_attivi_al', { p_data: giorno })
  const mappa = new Map<string | null, number>()
  for (const r of (data ?? []) as { gruppo_id: string | null; numero_attivi: number }[]) {
    mappa.set(r.gruppo_id, r.numero_attivi)
  }
  return mappa
}

/** Vendite e fatturato (abbonamenti_giornalieri, senza filtro gruppo) in un giorno solo. */
async function venditeDelGiorno(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  giorno: string
): Promise<{ vendite: number; fatturato: number }> {
  const { data } = await supabase.from('abbonamenti_giornalieri').select('numero_vendite, fatturato').eq('giorno', giorno)
  return (data ?? []).reduce(
    (tot, r) => ({ vendite: tot.vendite + r.numero_vendite, fatturato: tot.fatturato + Number(r.fatturato ?? 0) }),
    { vendite: 0, fatturato: 0 }
  )
}

/** Carica i dati del resoconto per un giorno (formato YYYY-MM-DD, fuso Roma). */
export async function caricaResocontoDirezionale(giorno: string): Promise<ResocontoDirezionale> {
  const supabase = createSupabaseServiceClient()
  const gruppi = await caricaGruppi()
  const core = gruppi.find((g) => g.nome === 'CORE') ?? null
  const annoCorrente = Number(giorno.slice(0, 4))
  const inizioGiorno = mezzanotteRoma(giorno)
  const inizioGiornoDopo = mezzanotteRoma(giornoPiu(giorno, 1))

  const [{ data: righeGiorno }, { data: righeTipo }] = await Promise.all([
    supabase.from('abbonamenti_giornalieri').select('gruppo_id, numero_vendite, fatturato').eq('giorno', giorno),
    core
      ? supabase
          .from('abbonamenti_giornalieri_tipo')
          .select('rinnovo, numero_vendite, fatturato')
          .eq('giorno', giorno)
          .eq('gruppo_id', core.id)
      : Promise.resolve({ data: [] as { rinnovo: boolean; numero_vendite: number; fatturato: number | null }[] }),
  ])

  // Fatturato MTD/YTD "a parità di giorni" con l'anno prima — stessa logica
  // di /dashboard/direzione (lib/direzione.ts: rangeMTD/rangeYTD).
  const [fatturatoMTDAttuale, fatturatoMTDPrec, fatturatoYTDAttuale, fatturatoYTDPrec] = await Promise.all([
    fatturatoDelPeriodo(supabase, rangeMTD(annoCorrente)),
    fatturatoDelPeriodo(supabase, rangeMTD(annoCorrente - 1)),
    fatturatoDelPeriodo(supabase, rangeYTD(annoCorrente)),
    fatturatoDelPeriodo(supabase, rangeYTD(annoCorrente - 1)),
  ])

  // Soci attivi oggi, per gruppo, a parità di giorno con un anno fa
  // (abbonamenti_attivi_al è una fotografia, non una vendita — vedi
  // scripts/sql/2026-09-21-abbonamenti-attivi.sql).
  const ieri = giornoPiu(giorno, -1)
  const unAnnoFa = stessoGiornoMesiFa(giorno, -12)
  const [sociOggiMappa, sociAnnoFaMappa, venditeIeri] = await Promise.all([
    sociAttiviPerGruppoAl(supabase, giorno),
    sociAttiviPerGruppoAl(supabase, unAnnoFa),
    venditeDelGiorno(supabase, ieri),
  ])

  const sociPerGruppo: RigaSoci[] = gruppi
    .map((g: Gruppo) => ({ gruppoId: g.id, nome: g.nome, oggi: sociOggiMappa.get(g.id) ?? 0, annoScorso: sociAnnoFaMappa.get(g.id) ?? 0 }))
    .filter((r) => r.oggi > 0 || r.annoScorso > 0)

  const sociNonCatOggi = sociOggiMappa.get(null) ?? 0
  const sociNonCatAnnoFa = sociAnnoFaMappa.get(null) ?? 0
  const sociNonCategorizzato =
    sociNonCatOggi > 0 || sociNonCatAnnoFa > 0
      ? { gruppoId: NON_CATEGORIZZATO, nome: 'Non categorizzato', oggi: sociNonCatOggi, annoScorso: sociNonCatAnnoFa }
      : null

  const sociTotale = {
    oggi: [...sociOggiMappa.values()].reduce((tot, n) => tot + n, 0),
    annoScorso: [...sociAnnoFaMappa.values()].reduce((tot, n) => tot + n, 0),
  }

  // Contatti acquisiti oggi, sito vs walk-in (guest register) — stessa
  // classificazione binaria del grafico a 12 mesi in /dashboard/direzione.
  const { data: contattiOggiRighe } = await supabase
    .from('form_contatti')
    .select('origine')
    .gte('created_at', inizioGiorno)
    .lt('created_at', inizioGiornoDopo)
  let web = 0
  let walkIn = 0
  for (const r of contattiOggiRighe ?? []) {
    if (provenienzaDiOrigine(r.origine).chiave === 'guest-register') walkIn += 1
    else web += 1
  }

  // Visite al sito di oggi: stessa definizione di "persone" della vista
  // sessioni_mensili (scripts/sql/2026-09-21-sessioni-mensili.sql) — chi ha
  // dato il consenso conta una volta sola (distinct visitor_id), le sessioni
  // senza consenso contano una testa ciascuna. Qui in JS e non da una vista
  // perché un solo giorno sono poche righe: non serve un'aggregazione lato
  // database come per lo storico mensile (decine di migliaia di righe).
  const { data: sessioniOggiRighe } = await supabase
    .from('sessioni')
    .select('visitor_id')
    .gte('created_at', inizioGiorno)
    .lt('created_at', inizioGiornoDopo)
  const righeSessioni = sessioniOggiRighe ?? []
  const visitatoriConConsenso = new Set(righeSessioni.map((r) => r.visitor_id).filter(Boolean) as string[])
  const sessioniSenzaConsenso = righeSessioni.filter((r) => !r.visitor_id).length
  const visiteSitoOggi = { sessioni: righeSessioni.length, persone: visitatoriConConsenso.size + sessioniSenzaConsenso }

  const perGruppoMappa = new Map<string | null, { vendite: number; fatturato: number }>()
  for (const r of righeGiorno ?? []) {
    const voce = perGruppoMappa.get(r.gruppo_id) ?? { vendite: 0, fatturato: 0 }
    voce.vendite += r.numero_vendite
    voce.fatturato += Number(r.fatturato ?? 0)
    perGruppoMappa.set(r.gruppo_id, voce)
  }

  // Nell'ordine di abbonamenti_gruppi.ordine, come ovunque nel pannello — un
  // gruppo senza vendite oggi non compare, non ha senso riempire l'email di
  // righe a zero per gruppi rimasti fermi.
  const perGruppo: RigaGruppo[] = gruppi
    .map((g: Gruppo) => ({ gruppoId: g.id, nome: g.nome, ...(perGruppoMappa.get(g.id) ?? { vendite: 0, fatturato: 0 }) }))
    .filter((r) => r.vendite > 0)

  const nonCategorizzatoGrezzo = perGruppoMappa.get(null)
  const nonCategorizzato =
    nonCategorizzatoGrezzo && nonCategorizzatoGrezzo.vendite > 0
      ? { gruppoId: NON_CATEGORIZZATO, nome: 'Non categorizzato', ...nonCategorizzatoGrezzo }
      : null

  const totale = [...perGruppoMappa.values()].reduce(
    (tot, v) => ({ vendite: tot.vendite + v.vendite, fatturato: tot.fatturato + v.fatturato }),
    { vendite: 0, fatturato: 0 }
  )

  const sommaTipo = (rinnovo: boolean) =>
    (righeTipo ?? [])
      .filter((r) => r.rinnovo === rinnovo)
      .reduce(
        (tot, r) => ({ vendite: tot.vendite + r.numero_vendite, fatturato: tot.fatturato + Number(r.fatturato ?? 0) }),
        { vendite: 0, fatturato: 0 }
      )

  return {
    giorno,
    dataLeggibile: dataLeggibileDi(giorno),
    fatturatoMTD: { attuale: fatturatoMTDAttuale, precedente: fatturatoMTDPrec },
    fatturatoYTD: { attuale: fatturatoYTDAttuale, precedente: fatturatoYTDPrec },
    sociPerGruppo,
    sociNonCategorizzato,
    sociTotale,
    contattiOggi: { totale: web + walkIn, web, walkIn },
    visiteSitoOggi,
    venditeIeri,
    perGruppo,
    nonCategorizzato,
    totale,
    core: core ? { nuovi: sommaTipo(false), rinnovi: sommaTipo(true) } : null,
  }
}

// ───────────────────────────────────────────────────── il vestito grafico
//
// Gli stessi colori e caratteri del pannello (vedi il blocco dei token in
// app/globals.css: "il pannello deve sembrare la stessa casa vista da
// dietro" — vale anche per l'email che ne esce). Qui sono valori scritti a
// mano e non var(--token): i client di posta non eseguono i CSS custom
// properties in modo affidabile (Outlook li ignora del tutto), quindi si
// riportano gli stessi esadecimali invece di referenziare le variabili.
const COLORE = {
  sfondo: '#f8f2e5', // --bg
  superficie: '#fdfaf3', // --surface
  intestazione: '#1c1c18', // --bg-dark
  testo: '#17170f', // --text
  testoSuScuro: '#f6efde', // --text-on-dark
  mutato: '#3d3d33', // --text-muted
  bordo: 'rgba(28, 28, 24, 0.14)', // --border
  accento: '#8b6c14', // --accent
  accentoVelo: 'rgba(139, 108, 20, 0.1)', // --accent-tint
  ok: '#4a6b3a',
  errore: '#8c3320',
} as const

const FONT_SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const FONT_SANS = "'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"

const RIGA_STILE = `padding:8px 12px;border-bottom:1px solid ${COLORE.bordo};`
const RIGA_STILE_NUMERO = `${RIGA_STILE}text-align:right;font-variant-numeric:tabular-nums;`

function titoloSezioneHtml(testo: string): string {
  return `<h2 style="font-family:${FONT_SERIF};font-weight:600;font-size:19px;color:${COLORE.testo};margin:0 0 10px;">${testo}</h2>`
}

function rigaTabellaHtml(nome: string, vendite: number, fatturato: number, evidenziata = false): string {
  const sfondo = evidenziata ? `background:${COLORE.accentoVelo};` : ''
  const pesoRiga = evidenziata ? 'font-weight:600;' : ''
  return `<tr>
    <td style="${RIGA_STILE}${sfondo}${pesoRiga}">${nome}</td>
    <td style="${RIGA_STILE_NUMERO}${sfondo}${pesoRiga}">${vendite}</td>
    <td style="${RIGA_STILE_NUMERO}${sfondo}${pesoRiga}">${euro(fatturato) ?? '—'}</td>
  </tr>`
}

function intestazioneTabellaHtml(primaColonna: string): string {
  const th = (testo: string, allineaDestra = false) =>
    `<th align="${allineaDestra ? 'right' : 'left'}" style="padding:8px 12px;border-bottom:2px solid ${COLORE.accento};color:${COLORE.mutato};font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">${testo}</th>`
  return `<tr>${th(primaColonna)}${th('Vendite', true)}${th('Fatturato', true)}</tr>`
}

function rigaSociHtml(nome: string, oggi: number, annoScorso: number, evidenziata = false): string {
  const sfondo = evidenziata ? `background:${COLORE.accentoVelo};` : ''
  const pesoRiga = evidenziata ? 'font-weight:600;' : ''
  return `<tr>
    <td style="${RIGA_STILE}${sfondo}${pesoRiga}">${nome}</td>
    <td style="${RIGA_STILE_NUMERO}${sfondo}${pesoRiga}">${oggi}</td>
    <td style="${RIGA_STILE_NUMERO}${sfondo}${pesoRiga}">${variazionePercentualeHtml(oggi, annoScorso, 'anno scorso')}</td>
  </tr>`
}

function intestazioneSociHtml(): string {
  const th = (testo: string, allineaDestra = false) =>
    `<th align="${allineaDestra ? 'right' : 'left'}" style="padding:8px 12px;border-bottom:2px solid ${COLORE.accento};color:${COLORE.mutato};font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">${testo}</th>`
  return `<tr>${th('Gruppo')}${th('Soci attivi', true)}${th('vs anno scorso', true)}</tr>`
}

/** Una riga di KPI: etichetta a sinistra, valore (+ eventuale dettaglio piccolo) a destra. */
function rigaKpiHtml(etichetta: string, valoreHtml: string, dettaglioHtml?: string): string {
  return `<tr>
    <td style="${RIGA_STILE}color:${COLORE.mutato};">${etichetta}</td>
    <td style="${RIGA_STILE_NUMERO}font-weight:600;">${valoreHtml}${dettaglioHtml ? `<br><span style="font-size:12px;color:${COLORE.mutato};font-weight:400;">${dettaglioHtml}</span>` : ''}</td>
  </tr>`
}

/** Il testo di una variazione in euro, colorato di verde o rosso — gli stessi toni di stato del pannello (--ok/--error). */
function variazioneHtml(attuale: number, precedente: number, confronto = 'anno scorso'): string {
  const testo = testoVariazione(attuale, precedente)
  const percentuale = variazionePercentuale(attuale, precedente)
  const colore = percentuale === null ? COLORE.mutato : percentuale >= 0 ? COLORE.ok : COLORE.errore
  return `<span style="color:${colore};">${testo} vs ${confronto}</span>`
}

/** Come variazioneHtml, ma per un conteggio (vendite, non un importo): niente differenza in euro fra parentesi. */
function variazionePercentualeHtml(attuale: number, precedente: number, confronto = 'ieri'): string {
  const percentuale = variazionePercentuale(attuale, precedente)
  if (percentuale === null) return `<span style="color:${COLORE.mutato};">vs ${confronto}: —</span>`
  const colore = percentuale >= 0 ? COLORE.ok : COLORE.errore
  const segno = percentuale > 0 ? '+' : ''
  return `<span style="color:${colore};">${segno}${percentuale}% vs ${confronto}</span>`
}

function tabellaKpiHtml(righe: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;border-collapse:collapse;">${righe.join('')}</table>`
}

/** Compone oggetto, HTML e testo semplice dell'email — vedi Messaggio in lib/email.ts. */
export function componiEmailResoconto(r: ResocontoDirezionale): { oggetto: string; html: string; testo: string } {
  const corpoFatturato =
    titoloSezioneHtml('Fatturato') +
    tabellaKpiHtml([
      rigaKpiHtml('MTD (da inizio mese)', euro(r.fatturatoMTD.attuale) ?? '—', variazioneHtml(r.fatturatoMTD.attuale, r.fatturatoMTD.precedente)),
      rigaKpiHtml('YTD (da inizio anno)', euro(r.fatturatoYTD.attuale) ?? '—', variazioneHtml(r.fatturatoYTD.attuale, r.fatturatoYTD.precedente)),
    ])

  const righeSoci = [...r.sociPerGruppo.map((g) => rigaSociHtml(g.nome, g.oggi, g.annoScorso))]
  if (r.sociNonCategorizzato) righeSoci.push(rigaSociHtml(r.sociNonCategorizzato.nome, r.sociNonCategorizzato.oggi, r.sociNonCategorizzato.annoScorso))

  const corpoSociAttivi =
    titoloSezioneHtml('Soci attivi oggi, per gruppo') +
    (righeSoci.length === 0
      ? `<p style="color:${COLORE.mutato};margin:0 0 26px;">Nessun socio attivo oggi.</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;border-collapse:collapse;">
          ${intestazioneSociHtml()}
          ${righeSoci.join('')}
          ${rigaSociHtml('Totale', r.sociTotale.oggi, r.sociTotale.annoScorso, true)}
        </table>`)

  const corpoContatti =
    titoloSezioneHtml('Contatti acquisiti oggi') +
    tabellaKpiHtml([
      rigaKpiHtml('Totale', String(r.contattiOggi.totale)),
      rigaKpiHtml('Via web', String(r.contattiOggi.web)),
      rigaKpiHtml('Via walk-in', String(r.contattiOggi.walkIn)),
    ])

  const corpoVisiteSito =
    titoloSezioneHtml('Visite al sito oggi') +
    tabellaKpiHtml([
      rigaKpiHtml('Persone (stima)', String(r.visiteSitoOggi.persone)),
      rigaKpiHtml('Sessioni', String(r.visiteSitoOggi.sessioni)),
    ])

  const corpoConfrontoIeri =
    titoloSezioneHtml('Abbonamenti venduti: oggi vs ieri') +
    tabellaKpiHtml([
      rigaKpiHtml(
        'Vendite',
        String(r.totale.vendite),
        `${variazionePercentualeHtml(r.totale.vendite, r.venditeIeri.vendite)} · ieri: ${r.venditeIeri.vendite}`
      ),
      rigaKpiHtml(
        'Fatturato',
        euro(r.totale.fatturato) ?? '—',
        `${variazioneHtml(r.totale.fatturato, r.venditeIeri.fatturato, 'ieri')} · ieri: ${euro(r.venditeIeri.fatturato) ?? '—'}`
      ),
    ])

  const righeAbbonamenti = [...r.perGruppo.map((g) => rigaTabellaHtml(g.nome, g.vendite, g.fatturato))]
  if (r.nonCategorizzato) righeAbbonamenti.push(rigaTabellaHtml(r.nonCategorizzato.nome, r.nonCategorizzato.vendite, r.nonCategorizzato.fatturato))

  const corpoAbbonamenti =
    titoloSezioneHtml('Abbonamenti venduti oggi, per gruppo') +
    (righeAbbonamenti.length === 0
      ? `<p style="color:${COLORE.mutato};margin:0 0 26px;">Nessuna vendita registrata oggi.</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;border-collapse:collapse;">
          ${intestazioneTabellaHtml('Gruppo')}
          ${righeAbbonamenti.join('')}
          ${rigaTabellaHtml('Totale', r.totale.vendite, r.totale.fatturato, true)}
        </table>`)

  const corpoCore = !r.core
    ? ''
    : titoloSezioneHtml('Gruppo CORE — nuovi e rinnovi') +
      (r.core.nuovi.vendite + r.core.rinnovi.vendite === 0
        ? `<p style="color:${COLORE.mutato};margin:0;">Nessuna vendita CORE oggi.</p>`
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
             ${intestazioneTabellaHtml('Tipo')}
             ${rigaTabellaHtml('Nuovi', r.core.nuovi.vendite, r.core.nuovi.fatturato)}
             ${rigaTabellaHtml('Rinnovi', r.core.rinnovi.vendite, r.core.rinnovi.fatturato)}
             ${rigaTabellaHtml('Totale CORE', r.core.nuovi.vendite + r.core.rinnovi.vendite, r.core.nuovi.fatturato + r.core.rinnovi.fatturato, true)}
           </table>`)

  const html = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Resoconto Dashboard direzionale</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Cormorant+Garamond:wght@600&display=swap" rel="stylesheet">
  </head>
  <body style="margin:0;padding:0;background:${COLORE.sfondo};font-family:${FONT_SANS};color:${COLORE.testo};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORE.sfondo};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${COLORE.superficie};border-radius:8px;overflow:hidden;border:1px solid ${COLORE.bordo};">
            <tr>
              <td style="background:${COLORE.intestazione};padding:24px 28px;">
                <p style="margin:0;color:${COLORE.testoSuScuro};font-size:12px;letter-spacing:0.06em;text-transform:uppercase;opacity:0.75;">Dashboard direzionale · CRM Ronchiverdi</p>
                <h1 style="margin:6px 0 0;color:${COLORE.testoSuScuro};font-family:${FONT_SERIF};font-weight:600;font-size:26px;letter-spacing:-0.01em;">Resoconto del ${r.dataLeggibile}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${corpoFatturato}
                ${corpoSociAttivi}
                ${corpoContatti}
                ${corpoVisiteSito}
                ${corpoConfrontoIeri}
                ${corpoAbbonamenti}
                ${corpoCore}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:${COLORE.sfondo};border-top:1px solid ${COLORE.bordo};">
                <p style="margin:0;color:${COLORE.mutato};font-size:12px;">Generato automaticamente ogni sera dal CRM Ronchiverdi — Dashboard direzionale.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const rigaTesto = (nome: string, vendite: number, fatturato: number) => `- ${nome}: ${vendite} · ${euro(fatturato) ?? '—'}`
  const righeTestoAbbonamenti =
    righeAbbonamenti.length === 0
      ? ['Nessuna vendita registrata oggi.']
      : [
          ...r.perGruppo.map((g) => rigaTesto(g.nome, g.vendite, g.fatturato)),
          ...(r.nonCategorizzato ? [rigaTesto(r.nonCategorizzato.nome, r.nonCategorizzato.vendite, r.nonCategorizzato.fatturato)] : []),
          rigaTesto('Totale', r.totale.vendite, r.totale.fatturato),
        ]

  const rigaTestoSoci = (nome: string, oggi: number, annoScorso: number) => {
    const percentuale = variazionePercentuale(oggi, annoScorso)
    const variazione = percentuale === null ? '—' : `${percentuale > 0 ? '+' : ''}${percentuale}% vs anno scorso`
    return `- ${nome}: ${oggi} (${variazione})`
  }
  const righeTestoSoci =
    righeSoci.length === 0
      ? ['Nessun socio attivo oggi.']
      : [
          ...r.sociPerGruppo.map((g) => rigaTestoSoci(g.nome, g.oggi, g.annoScorso)),
          ...(r.sociNonCategorizzato ? [rigaTestoSoci(r.sociNonCategorizzato.nome, r.sociNonCategorizzato.oggi, r.sociNonCategorizzato.annoScorso)] : []),
          rigaTestoSoci('Totale', r.sociTotale.oggi, r.sociTotale.annoScorso),
        ]

  const righeTestoCore = !r.core
    ? []
    : [
        '',
        'Gruppo CORE — nuovi e rinnovi:',
        rigaTesto('Nuovi', r.core.nuovi.vendite, r.core.nuovi.fatturato),
        rigaTesto('Rinnovi', r.core.rinnovi.vendite, r.core.rinnovi.fatturato),
        rigaTesto('Totale CORE', r.core.nuovi.vendite + r.core.rinnovi.vendite, r.core.nuovi.fatturato + r.core.rinnovi.fatturato),
      ]

  const testo = [
    `Resoconto del ${r.dataLeggibile}`,
    '',
    'Fatturato:',
    `- MTD: ${euro(r.fatturatoMTD.attuale) ?? '—'} · ${testoVariazione(r.fatturatoMTD.attuale, r.fatturatoMTD.precedente)} vs anno scorso`,
    `- YTD: ${euro(r.fatturatoYTD.attuale) ?? '—'} · ${testoVariazione(r.fatturatoYTD.attuale, r.fatturatoYTD.precedente)} vs anno scorso`,
    '',
    'Soci attivi oggi, per gruppo:',
    ...righeTestoSoci,
    '',
    'Contatti acquisiti oggi:',
    `- Totale: ${r.contattiOggi.totale}`,
    `- Via web: ${r.contattiOggi.web}`,
    `- Via walk-in: ${r.contattiOggi.walkIn}`,
    '',
    'Visite al sito oggi:',
    `- Persone (stima): ${r.visiteSitoOggi.persone}`,
    `- Sessioni: ${r.visiteSitoOggi.sessioni}`,
    '',
    'Abbonamenti venduti: oggi vs ieri:',
    `- Vendite: ${r.totale.vendite} (ieri: ${r.venditeIeri.vendite})`,
    `- Fatturato: ${euro(r.totale.fatturato) ?? '—'} (ieri: ${euro(r.venditeIeri.fatturato) ?? '—'})`,
    '',
    'Abbonamenti venduti oggi, per gruppo:',
    ...righeTestoAbbonamenti,
    ...righeTestoCore,
  ].join('\n')

  return { oggetto: `Resoconto abbonamenti — ${r.dataLeggibile}`, html, testo }
}
