// Il caricamento a mano dei lead dei moduli Meta (Facebook / Instagram Lead
// Ads): si incolla l'esportazione di Gestione lead (o quattro colonne scritte
// a mano) e ogni riga diventa una richiesta in `form_contatti`, marcata
// origine 'meta-lead-ads' e con la campagna in utm_campaign — così il lead si
// riconosce da una targhetta ovunque compaia, e la dashboard direzionale lo
// conta come «Meta ADV» (vedi canaleGranulare in lib/canaliTraffico.ts).
//
// Nessun import server-only: lo usano la Server Action e, per l'anteprima, il
// form.

export { ORIGINE_META_LEAD } from './provenienza'

export type RigaLeadMeta = {
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  campagna: string | null
  gruppo: string | null
  inserzione: string | null
  /** Le colonne che non conosciamo, «nome colonna: valore». */
  extra: string | null
}

export type EsitoLettura = { righe: RigaLeadMeta[]; scartate: string[] }

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// I nomi delle colonne dell'esportazione di Meta (inglese) e quelli italiani
// che si scrivono a mano.
const ALIAS: Record<string, keyof RigaLeadMeta | 'nome_intero' | 'ignora'> = {
  first_name: 'nome',
  nome: 'nome',
  last_name: 'cognome',
  cognome: 'cognome',
  full_name: 'nome_intero',
  nome_e_cognome: 'nome_intero',
  nome_completo: 'nome_intero',
  email: 'email',
  'e-mail': 'email',
  phone_number: 'cellulare',
  phone: 'cellulare',
  telefono: 'cellulare',
  cellulare: 'cellulare',
  campaign_name: 'campagna',
  campagna: 'campagna',
  adset_name: 'gruppo',
  ad_name: 'inserzione',
  inserzione: 'inserzione',
  // Colonne dell'esportazione che non servono come «extra».
  id: 'ignora',
  created_time: 'ignora',
  ad_id: 'ignora',
  adset_id: 'ignora',
  campaign_id: 'ignora',
  form_id: 'ignora',
  form_name: 'ignora',
  is_organic: 'ignora',
  platform: 'ignora',
  lead_status: 'ignora',
}

const ORDINE_SENZA_INTESTAZIONE = ['nome', 'cognome', 'email', 'cellulare'] as const

function normalizzaColonna(c: string): string {
  return c.trim().toLowerCase().replace(/\s+/g, '_')
}

function dividiRiga(riga: string, sep: string): string[] {
  const celle: string[] = []
  let corrente = ''
  let tra = false
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i]
    if (c === '"') {
      if (tra && riga[i + 1] === '"') {
        corrente += '"'
        i++
      } else tra = !tra
    } else if (c === sep && !tra) {
      celle.push(corrente)
      corrente = ''
    } else corrente += c
  }
  celle.push(corrente)
  return celle.map((c) => c.trim())
}

/** Il telefono come lo scrive Meta («p:+39333…») ripulito dal prefisso. */
export function ripulisciTelefono(v: string | null | undefined): string | null {
  const t = String(v ?? '').replace(/^p:/i, '').trim()
  return t || null
}

/**
 * Legge il testo incollato. Con la riga di intestazione di Meta (full_name,
 * email, phone_number, campaign_name…) le colonne si riconoscono per nome, in
 * qualunque ordine; senza, l'ordine è Nome, Cognome, Email, Cellulare.
 * Separatore: tabulazione (Excel / Fogli), altrimenti «;» o «,».
 */
export function leggiLeadMeta(testo: string): EsitoLettura {
  // Il BOM che mette Excel all'inizio di un CSV farebbe sbagliare la prima colonna.
  const righeTesto = testo
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((r) => r.trim())
  if (righeTesto.length === 0) return { righe: [], scartate: [] }

  const sep = righeTesto.some((r) => r.includes('\t')) ? '\t' : righeTesto.some((r) => r.includes(';')) ? ';' : ','
  const prima = dividiRiga(righeTesto[0], sep).map(normalizzaColonna)
  const haIntestazione = !righeTesto[0].includes('@') && prima.some((c) => c in ALIAS)

  const colonne: string[] = haIntestazione ? prima : [...ORDINE_SENZA_INTESTAZIONE]
  const dati = haIntestazione ? righeTesto.slice(1) : righeTesto

  const righe: RigaLeadMeta[] = []
  const scartate: string[] = []

  for (const riga of dati) {
    const celle = dividiRiga(riga, sep)
    const r: RigaLeadMeta = {
      nome: null, cognome: null, email: null, cellulare: null,
      campagna: null, gruppo: null, inserzione: null, extra: null,
    }
    const extra: string[] = []
    colonne.forEach((col, i) => {
      const v = (celle[i] ?? '').trim()
      if (!v) return
      const tipo = ALIAS[col]
      if (tipo === 'nome_intero') {
        const [primo, ...resto] = v.split(/\s+/)
        r.nome = primo
        r.cognome = resto.join(' ') || null
      } else if (tipo === 'cellulare') r.cellulare = ripulisciTelefono(v)
      else if (tipo === 'email') r.email = v.toLowerCase()
      else if (tipo && tipo !== 'ignora') r[tipo] = v
      else if (!tipo) extra.push(`${col.replace(/_/g, ' ')}: ${v}`)
    })
    r.extra = extra.length ? extra.join('\n') : null

    // Serve almeno un modo per richiamare e un nome a cui riferirsi.
    if (r.email && !FORMATO_EMAIL.test(r.email)) {
      scartate.push(`${riga.slice(0, 60)} — email non valida`)
      continue
    }
    if (!r.email && !r.cellulare) {
      scartate.push(`${riga.slice(0, 60)} — né email né telefono`)
      continue
    }
    if (!r.nome && !r.cognome) {
      scartate.push(`${riga.slice(0, 60)} — manca il nome`)
      continue
    }
    righe.push(r)
  }
  return { righe, scartate }
}
