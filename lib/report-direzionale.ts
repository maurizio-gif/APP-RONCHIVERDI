// Il resoconto serale della Dashboard Direzionale: cosa si è venduto oggi,
// per gruppo prodotto, e — per il gruppo CORE — quanto di quel venduto è
// nuovo e quanto è un rinnovo. Vedi app/api/cron/report-direzionale/route.ts
// per lo scheduling; qui sta solo la lettura dei dati e la composizione
// dell'email, per poterla testare/rileggere senza la parte HTTP.

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { caricaGruppi, NON_CATEGORIZZATO, type Gruppo } from '@/lib/abbonamenti'
import { euro, testoVariazione } from '@/lib/pipeline'
import { giornoPiu, mezzanotteRoma, stessoGiornoMesiFa } from '@/lib/agenda'
import { rangeMTD, rangeYTD, type RangePeriodo } from '@/lib/direzione'
import { provenienzaDiOrigine } from '@/lib/provenienza'

type RigaGruppo = { gruppoId: string; nome: string; vendite: number; fatturato: number }

type ConfrontoPeriodo = { attuale: number; precedente: number }

export type ResocontoDirezionale = {
  giorno: string
  dataLeggibile: string
  fatturatoMTD: ConfrontoPeriodo
  fatturatoYTD: ConfrontoPeriodo
  sociAttivi: { oggi: number; ieri: number; unMeseFa: number; unAnnoFa: number }
  contattiOggi: { totale: number; web: number; walkIn: number }
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

/** Soci attivi (abbonamenti_attivi_al), sommati su tutti i gruppi, in un giorno. */
async function sociAttiviAl(supabase: ReturnType<typeof createSupabaseServiceClient>, giorno: string): Promise<number> {
  const { data } = await supabase.rpc('abbonamenti_attivi_al', { p_data: giorno })
  const righe = (data ?? []) as { gruppo_id: string | null; numero_attivi: number }[]
  return righe.reduce((tot, r) => tot + r.numero_attivi, 0)
}

/** Carica i dati del resoconto per un giorno (formato YYYY-MM-DD, fuso Roma). */
export async function caricaResocontoDirezionale(giorno: string): Promise<ResocontoDirezionale> {
  const supabase = createSupabaseServiceClient()
  const gruppi = await caricaGruppi()
  const core = gruppi.find((g) => g.nome === 'CORE') ?? null
  const annoCorrente = Number(giorno.slice(0, 4))

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

  // Soci attivi: oggi, ieri, un mese fa e un anno fa allo stesso giorno del
  // mese (abbonamenti_attivi_al è una fotografia, non una vendita — vedi
  // scripts/sql/2026-09-21-abbonamenti-attivi.sql).
  const ieri = giornoPiu(giorno, -1)
  const unMeseFa = stessoGiornoMesiFa(giorno, -1)
  const unAnnoFa = stessoGiornoMesiFa(giorno, -12)
  const [sociOggi, sociIeri, sociUnMeseFa, sociUnAnnoFa] = await Promise.all([
    sociAttiviAl(supabase, giorno),
    sociAttiviAl(supabase, ieri),
    sociAttiviAl(supabase, unMeseFa),
    sociAttiviAl(supabase, unAnnoFa),
  ])

  // Contatti acquisiti oggi, sito vs walk-in (guest register) — stessa
  // classificazione binaria del grafico a 12 mesi in /dashboard/direzione.
  const { data: contattiOggiRighe } = await supabase
    .from('form_contatti')
    .select('origine')
    .gte('created_at', mezzanotteRoma(giorno))
    .lt('created_at', mezzanotteRoma(giornoPiu(giorno, 1)))
  let web = 0
  let walkIn = 0
  for (const r of contattiOggiRighe ?? []) {
    if (provenienzaDiOrigine(r.origine).chiave === 'guest-register') walkIn += 1
    else web += 1
  }

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
    sociAttivi: { oggi: sociOggi, ieri: sociIeri, unMeseFa: sociUnMeseFa, unAnnoFa: sociUnAnnoFa },
    contattiOggi: { totale: web + walkIn, web, walkIn },
    perGruppo,
    nonCategorizzato,
    totale,
    core: core ? { nuovi: sommaTipo(false), rinnovi: sommaTipo(true) } : null,
  }
}

const RIGA_STILE = 'padding:8px 12px;border-bottom:1px solid #eee2cf;'
const RIGA_STILE_NUMERO = `${RIGA_STILE}text-align:right;font-variant-numeric:tabular-nums;`

function rigaTabellaHtml(nome: string, vendite: number, fatturato: number, evidenziata = false): string {
  const pesoRiga = evidenziata ? 'font-weight:600;' : ''
  return `<tr>
    <td style="${RIGA_STILE}${pesoRiga}">${nome}</td>
    <td style="${RIGA_STILE_NUMERO}${pesoRiga}">${vendite}</td>
    <td style="${RIGA_STILE_NUMERO}${pesoRiga}">${euro(fatturato) ?? '—'}</td>
  </tr>`
}

function intestazioneTabellaHtml(): string {
  return `<tr>
    <th align="left" style="padding:8px 12px;border-bottom:2px solid #2a78d6;color:#5a5346;font-size:13px;text-transform:uppercase;letter-spacing:0.03em;">Gruppo</th>
    <th align="right" style="padding:8px 12px;border-bottom:2px solid #2a78d6;color:#5a5346;font-size:13px;text-transform:uppercase;letter-spacing:0.03em;">Vendite</th>
    <th align="right" style="padding:8px 12px;border-bottom:2px solid #2a78d6;color:#5a5346;font-size:13px;text-transform:uppercase;letter-spacing:0.03em;">Fatturato</th>
  </tr>`
}

function rigaKpiHtml(etichetta: string, valore: string, dettaglio?: string): string {
  return `<tr>
    <td style="${RIGA_STILE}">${etichetta}</td>
    <td style="${RIGA_STILE_NUMERO}">${valore}${dettaglio ? `<br><span style="font-size:12px;color:#8a8272;font-weight:400;">${dettaglio}</span>` : ''}</td>
  </tr>`
}

/** Compone oggetto, HTML e testo semplice dell'email — vedi Messaggio in lib/email.ts. */
export function componiEmailResoconto(r: ResocontoDirezionale): { oggetto: string; html: string; testo: string } {
  const corpoFatturato = `<h2 style="font-size:16px;color:#2a2013;margin:0 0 8px;">Fatturato</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-collapse:collapse;">
      ${rigaKpiHtml('MTD (da inizio mese)', euro(r.fatturatoMTD.attuale) ?? '—', testoVariazione(r.fatturatoMTD.attuale, r.fatturatoMTD.precedente) + ' vs anno scorso')}
      ${rigaKpiHtml('YTD (da inizio anno)', euro(r.fatturatoYTD.attuale) ?? '—', testoVariazione(r.fatturatoYTD.attuale, r.fatturatoYTD.precedente) + ' vs anno scorso')}
    </table>`

  const corpoSociAttivi = `<h2 style="font-size:16px;color:#2a2013;margin:0 0 8px;">Soci attivi</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-collapse:collapse;">
      ${rigaKpiHtml('Oggi', String(r.sociAttivi.oggi))}
      ${rigaKpiHtml('Ieri', String(r.sociAttivi.ieri))}
      ${rigaKpiHtml('Un mese fa', String(r.sociAttivi.unMeseFa))}
      ${rigaKpiHtml('Un anno fa', String(r.sociAttivi.unAnnoFa))}
    </table>`

  const corpoContatti = `<h2 style="font-size:16px;color:#2a2013;margin:0 0 8px;">Contatti acquisiti oggi</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-collapse:collapse;">
      ${rigaKpiHtml('Totale', String(r.contattiOggi.totale))}
      ${rigaKpiHtml('Via web', String(r.contattiOggi.web))}
      ${rigaKpiHtml('Via walk-in', String(r.contattiOggi.walkIn))}
    </table>`

  const righeAbbonamenti = [...r.perGruppo.map((g) => rigaTabellaHtml(g.nome, g.vendite, g.fatturato))]
  if (r.nonCategorizzato) righeAbbonamenti.push(rigaTabellaHtml(r.nonCategorizzato.nome, r.nonCategorizzato.vendite, r.nonCategorizzato.fatturato))

  const corpoAbbonamenti =
    righeAbbonamenti.length === 0
      ? '<p style="color:#8a8272;margin:0 0 24px;">Nessuna vendita registrata oggi.</p>'
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-collapse:collapse;">
          ${intestazioneTabellaHtml()}
          ${righeAbbonamenti.join('')}
          ${rigaTabellaHtml('Totale', r.totale.vendite, r.totale.fatturato, true)}
        </table>`

  const corpoCore = !r.core
    ? ''
    : r.core.nuovi.vendite + r.core.rinnovi.vendite === 0
      ? '<h2 style="font-size:16px;color:#2a2013;margin:0 0 8px;">Gruppo CORE — nuovi e rinnovi</h2><p style="color:#8a8272;margin:0;">Nessuna vendita CORE oggi.</p>'
      : `<h2 style="font-size:16px;color:#2a2013;margin:0 0 8px;">Gruppo CORE — nuovi e rinnovi</h2>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
           ${intestazioneTabellaHtml()
             .replace('Gruppo', 'Tipo')}
           ${rigaTabellaHtml('Nuovi', r.core.nuovi.vendite, r.core.nuovi.fatturato)}
           ${rigaTabellaHtml('Rinnovi', r.core.rinnovi.vendite, r.core.rinnovi.fatturato)}
           ${rigaTabellaHtml('Totale CORE', r.core.nuovi.vendite + r.core.rinnovi.vendite, r.core.nuovi.fatturato + r.core.rinnovi.fatturato, true)}
         </table>`

  const html = `<!doctype html>
<html lang="it">
  <body style="margin:0;padding:0;background:#fdfaf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#2a2013;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #eee2cf;">
            <tr>
              <td style="background:#2a78d6;padding:20px 28px;">
                <p style="margin:0;color:#ffffff;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.85;">Dashboard direzionale</p>
                <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;">Resoconto del ${r.dataLeggibile}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${corpoFatturato}
                ${corpoSociAttivi}
                ${corpoContatti}
                <h2 style="font-size:16px;color:#2a2013;margin:0 0 8px;">Abbonamenti venduti oggi, per gruppo</h2>
                ${corpoAbbonamenti}
                ${corpoCore}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#fdfaf3;border-top:1px solid #eee2cf;">
                <p style="margin:0;color:#8a8272;font-size:12px;">Generato automaticamente ogni sera dal CRM Ronchiverdi — Dashboard direzionale.</p>
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
    'Soci attivi:',
    `- Oggi: ${r.sociAttivi.oggi}`,
    `- Ieri: ${r.sociAttivi.ieri}`,
    `- Un mese fa: ${r.sociAttivi.unMeseFa}`,
    `- Un anno fa: ${r.sociAttivi.unAnnoFa}`,
    '',
    'Contatti acquisiti oggi:',
    `- Totale: ${r.contattiOggi.totale}`,
    `- Via web: ${r.contattiOggi.web}`,
    `- Via walk-in: ${r.contattiOggi.walkIn}`,
    '',
    'Abbonamenti venduti oggi, per gruppo:',
    ...righeTestoAbbonamenti,
    ...righeTestoCore,
  ].join('\n')

  return { oggetto: `Resoconto abbonamenti — ${r.dataLeggibile}`, html, testo }
}
