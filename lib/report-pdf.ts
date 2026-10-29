import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { dataEstesa, numeroIt, type ReportDati, type VoceReport } from '@/lib/report'
import {
  costruisciBlocchi,
  esitoConfronto,
  testoConfronto,
  type Blocco,
  type ColoreBlocco,
  type NumeroBlocco,
} from '@/lib/report-blocchi'

// Il PDF del report per periodo: disegna i blocchi di lib/report-blocchi.ts
// (gli stessi dell'anteprima a schermo). Disegnato a mano con pdf-lib (JavaScript
// puro, nessun file da trovare a runtime né browser da lanciare: gira
// identico su Vercel e in locale). Font standard del PDF — Times per i titoli,
// Helvetica per il resto — che coprono tutte le lettere accentate italiane e
// l'euro; il testo passa da `pulito`, che sostituisce quello che un font
// standard non sa scrivere invece di far fallire l'intero documento.

const A4 = { larghezza: 595.28, altezza: 841.89 }
const MARGINE = 44
const MARGINE_BASSO = 52
const LARGHEZZA_UTILE = A4.larghezza - MARGINE * 2

const ORO = rgb(0.545, 0.424, 0.078)
const ORO_CHIARO = rgb(0.93, 0.89, 0.78)
const INCHIOSTRO = rgb(0.09, 0.09, 0.06)
const GRIGIO = rgb(0.43, 0.42, 0.38)
const LINEA = rgb(0.87, 0.85, 0.79)
const FONDO = rgb(0.975, 0.955, 0.91)
const VERDE = rgb(0.29, 0.42, 0.23)
const ROSSO = rgb(0.55, 0.2, 0.13)
const BLU = rgb(0.21, 0.34, 0.42)

type Carattere = { regolare: PDFFont; grassetto: PDFFont; serif: PDFFont; serifGrassetto: PDFFont }

class Documento {
  doc!: PDFDocument
  f!: Carattere
  pagina!: PDFPage
  y = 0

  static async crea(): Promise<Documento> {
    const d = new Documento()
    d.doc = await PDFDocument.create()
    d.f = {
      regolare: await d.doc.embedFont(StandardFonts.Helvetica),
      grassetto: await d.doc.embedFont(StandardFonts.HelveticaBold),
      serif: await d.doc.embedFont(StandardFonts.TimesRoman),
      serifGrassetto: await d.doc.embedFont(StandardFonts.TimesRomanBold),
    }
    d.nuovaPagina()
    return d
  }

  nuovaPagina() {
    this.pagina = this.doc.addPage([A4.larghezza, A4.altezza])
    this.y = A4.altezza - MARGINE
  }

  /** Va a pagina nuova se non c'è spazio per `altezza`. */
  assicura(altezza: number) {
    if (this.y - altezza < MARGINE_BASSO) this.nuovaPagina()
  }

  /** Il testo come lo sa scrivere il font: le lettere fuori dal set diventano un segno vicino. */
  pulito(testo: string, font: PDFFont): string {
    const ammessi = new Set(font.getCharacterSet())
    const sostituzioni: Record<string, string> = { '▲': '+', '▼': '-', '−': '-', '→': '->', '≥': '>=', '≤': '<=', '’': "'", '‘': "'", ' ': ' ' }
    let fuori = ''
    for (const c of testo.normalize('NFC')) {
      const s = sostituzioni[c] ?? c
      for (const x of s) fuori += ammessi.has(x.codePointAt(0)!) ? x : '?'
    }
    return fuori
  }

  larghezza(testo: string, font: PDFFont, size: number): number {
    return font.widthOfTextAtSize(this.pulito(testo, font), size)
  }

  /** Taglia con «...» un testo più largo dello spazio. */
  taglia(testo: string, font: PDFFont, size: number, max: number): string {
    if (this.larghezza(testo, font, size) <= max) return testo
    let t = testo
    while (t.length > 1 && this.larghezza(`${t}...`, font, size) > max) t = t.slice(0, -1)
    return `${t.trimEnd()}...`
  }

  testo(
    t: string,
    x: number,
    y: number,
    { font = this.f.regolare, size = 9, colore = INCHIOSTRO, allinea = 'sinistra', larghezza = 0 }: {
      font?: PDFFont
      size?: number
      colore?: RGB
      allinea?: 'sinistra' | 'destra' | 'centro'
      /** Per destra e centro: la larghezza dello spazio in cui allineare. */
      larghezza?: number
    } = {}
  ) {
    const s = this.pulito(t, font)
    const w = font.widthOfTextAtSize(s, size)
    const px = allinea === 'destra' ? x + larghezza - w : allinea === 'centro' ? x + (larghezza - w) / 2 : x
    this.pagina.drawText(s, { x: px, y, size, font, color: colore })
  }

  /** Un paragrafo che va a capo; restituisce l'altezza usata. */
  paragrafo(t: string, { size = 9, font = this.f.regolare, colore = INCHIOSTRO, max = LARGHEZZA_UTILE, interlinea = 1.35 } = {}): void {
    const parole = this.pulito(t, font).split(/\s+/)
    const righe: string[] = []
    let corrente = ''
    for (const p of parole) {
      const prova = corrente ? `${corrente} ${p}` : p
      if (font.widthOfTextAtSize(prova, size) > max && corrente) {
        righe.push(corrente)
        corrente = p
      } else corrente = prova
    }
    if (corrente) righe.push(corrente)
    for (const r of righe) {
      this.assicura(size * interlinea)
      this.y -= size * interlinea
      this.pagina.drawText(r, { x: MARGINE, y: this.y, size, font, color: colore })
    }
  }

  spazio(h: number) {
    this.y -= h
  }

  linea(x1: number, x2: number, y: number, colore = LINEA, spessore = 0.6) {
    this.pagina.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: spessore, color: colore })
  }

  rettangolo(x: number, y: number, w: number, h: number, colore: RGB) {
    this.pagina.drawRectangle({ x, y, width: Math.max(w, 0), height: Math.max(h, 0), color: colore })
  }

  // ───────────────────────────────────────────────────────── componenti

  titoloSezione(titolo: string, nota?: string) {
    // Titolo, nota e la prima fila di numeri stanno nella stessa pagina: un
    // titolo in fondo con i numeri alla pagina dopo sembra un errore.
    this.assicura(140)
    this.spazio(16)
    this.y -= 15
    this.testo(titolo, MARGINE, this.y, { font: this.f.serifGrassetto, size: 15 })
    this.y -= 5
    this.linea(MARGINE, MARGINE + LARGHEZZA_UTILE, this.y, ORO, 1.2)
    if (nota) {
      this.y -= 4
      this.paragrafo(nota, { size: 8, colore: GRIGIO })
    }
    this.spazio(8)
  }

  sottotitolo(t: string) {
    // Il sottotitolo non resta solo in fondo a una pagina: ci vuole posto
    // anche per l'intestazione della tabella e per una riga.
    this.assicura(66)
    this.spazio(8)
    this.y -= 10
    this.testo(t, MARGINE, this.y, { font: this.f.grassetto, size: 9.5, colore: ORO })
    this.spazio(4)
  }

  nota(t: string) {
    this.spazio(4)
    this.paragrafo(t, { size: 8, colore: GRIGIO })
  }

  /** Una fila di numeri in evidenza, con il confronto sotto: verde se è una buona notizia, rosso se cattiva. */
  numeri(voci: NumeroBlocco[]) {
    const altezza = 52
    const spazio = 8
    const larghezza = (LARGHEZZA_UTILE - spazio * (voci.length - 1)) / voci.length
    this.assicura(altezza + 6)
    const alto = this.y
    voci.forEach((v, i) => {
      const x = MARGINE + i * (larghezza + spazio)
      this.rettangolo(x, alto - altezza, larghezza, altezza, FONDO)
      this.rettangolo(x, alto - altezza, 2.5, altezza, ORO)
      this.testo(this.taglia(v.etichetta, this.f.regolare, 7.5, larghezza - 16), x + 10, alto - 13, { size: 7.5, colore: GRIGIO })
      this.testo(this.taglia(v.valore, this.f.serifGrassetto, 17, larghezza - 16), x + 10, alto - 31, { font: this.f.serifGrassetto, size: 17 })
      const sotto = v.confronto ? testoConfronto(v.confronto) : v.sotto
      if (sotto) {
        const esito = v.confronto ? esitoConfronto(v.confronto, v.buonoSeCala) : 'neutro'
        const colore = esito === 'buono' ? VERDE : esito === 'cattivo' ? ROSSO : GRIGIO
        this.testo(this.taglia(sotto, this.f.regolare, 7.5, larghezza - 16), x + 10, alto - 44, { size: 7.5, colore })
      }
    })
    this.y = alto - altezza - 8
  }

  /** Una tabella con intestazione che si ripete a ogni pagina e, se c'è, una riga di totale. */
  tabella(
    colonne: { titolo: string; larghezza: number; destra?: boolean }[],
    righe: string[][],
    totale?: string[]
  ) {
    const totW = colonne.reduce((s, c) => s + c.larghezza, 0)
    const scala = LARGHEZZA_UTILE / totW
    const col = colonne.map((c) => ({ ...c, larghezza: c.larghezza * scala }))
    const intestazione = () => {
      this.assicura(34)
      this.y -= 12
      let x = MARGINE
      for (const c of col) {
        this.testo(c.titolo, x + (c.destra ? 0 : 3), this.y, { font: this.f.grassetto, size: 7.5, colore: GRIGIO, allinea: c.destra ? 'destra' : 'sinistra', larghezza: c.larghezza - 3 })
        x += c.larghezza
      }
      this.y -= 4
      this.linea(MARGINE, MARGINE + LARGHEZZA_UTILE, this.y, GRIGIO, 0.8)
    }
    const riga = (celle: string[], grassetto = false) => {
      if (this.y - 16 < MARGINE_BASSO) {
        this.nuovaPagina()
        intestazione()
      }
      this.y -= 13
      let x = MARGINE
      celle.forEach((t, i) => {
        const c = col[i]
        const font = grassetto ? this.f.grassetto : this.f.regolare
        this.testo(this.taglia(t, font, 8.5, c.larghezza - 8), x + (c.destra ? 0 : 3), this.y, { font, size: 8.5, allinea: c.destra ? 'destra' : 'sinistra', larghezza: c.larghezza - 3 })
        x += c.larghezza
      })
      this.y -= 4
      this.linea(MARGINE, MARGINE + LARGHEZZA_UTILE, this.y, grassetto ? GRIGIO : LINEA, grassetto ? 0.8 : 0.5)
    }
    intestazione()
    for (const r of righe) riga(r)
    if (totale) riga(totale, true)
    this.spazio(4)
  }

  /** Barre orizzontali: etichetta, barra lunga come il valore sul massimo, valore e quota. */
  barre(voci: VoceReport[], { formato = numeroIt, colore = ORO, quota = true }: { formato?: (n: number) => string; colore?: RGB; quota?: boolean } = {}) {
    const visibili = voci.filter((v) => v.valore !== 0)
    if (visibili.length === 0) {
      this.nota('Nessun dato nel periodo.')
      return
    }
    const massimo = Math.max(...visibili.map((v) => Math.abs(v.valore)), 1)
    const totale = visibili.reduce((s, v) => s + Math.max(v.valore, 0), 0)
    const etichettaW = 150
    const valoreW = 96
    const pista = LARGHEZZA_UTILE - etichettaW - valoreW - 12
    for (const v of visibili) {
      this.assicura(17)
      this.y -= 13
      this.testo(this.taglia(v.etichetta, this.f.regolare, 8.5, etichettaW - 6), MARGINE, this.y, { size: 8.5 })
      this.rettangolo(MARGINE + etichettaW, this.y - 1.5, pista, 8, FONDO)
      this.rettangolo(MARGINE + etichettaW, this.y - 1.5, (Math.abs(v.valore) / massimo) * pista, 8, v.valore < 0 ? ROSSO : colore)
      const testo = quota && totale > 0 && v.valore > 0 ? `${formato(v.valore)}  ${Math.round((v.valore / totale) * 100)}%` : formato(v.valore)
      this.testo(testo, MARGINE + etichettaW + pista + 6, this.y, { size: 8.5, allinea: 'destra', larghezza: valoreW })
      this.y -= 3
    }
    this.spazio(4)
  }

  /**
   * Colonne affiancate o impilate per periodo (mese o giorno). `serie` è una
   * lista di serie con lo stesso numero di valori; impilate se più d'una.
   */
  colonne(etichette: string[], serie: { nome: string; valori: number[]; colore: RGB }[]) {
    if (etichette.length < 2) return
    const altezza = 92
    this.assicura(altezza + 40)
    const alto = this.y - 6
    const base = alto - altezza
    const totali = etichette.map((_, i) => serie.reduce((s, x) => s + (x.valori[i] ?? 0), 0))
    const massimo = Math.max(...totali, 1)
    const passo = LARGHEZZA_UTILE / etichette.length
    const spessore = Math.min(passo * 0.7, 26)

    for (const f of [0.5, 1]) this.linea(MARGINE, MARGINE + LARGHEZZA_UTILE, base + altezza * f, LINEA, 0.4)
    this.testo(numeroIt(massimo), MARGINE, base + altezza + 2, { size: 6.5, colore: GRIGIO })
    etichette.forEach((_, i) => {
      let y = base
      const x = MARGINE + i * passo + (passo - spessore) / 2
      for (const s of serie) {
        const h = ((s.valori[i] ?? 0) / massimo) * altezza
        this.rettangolo(x, y, spessore, h, s.colore)
        y += h
      }
    })
    this.linea(MARGINE, MARGINE + LARGHEZZA_UTILE, base, GRIGIO, 0.7)
    const ogni = Math.max(1, Math.ceil(etichette.length / 12))
    etichette.forEach((e, i) => {
      if (i % ogni === 0) this.testo(e, MARGINE + i * passo, base - 10, { size: 6.5, colore: GRIGIO, allinea: 'centro', larghezza: passo })
    })
    // Legenda.
    let lx = MARGINE
    const ly = base - 23
    for (const s of serie) {
      if (serie.length < 2) break
      this.rettangolo(lx, ly, 7, 7, s.colore)
      this.testo(s.nome, lx + 11, ly, { size: 7.5, colore: GRIGIO })
      lx += 22 + this.larghezza(s.nome, this.f.regolare, 7.5)
    }
    this.y = base - (serie.length > 1 ? 32 : 20)
  }
}

const COLORI: Record<ColoreBlocco, RGB> = { oro: ORO, blu: BLU, verde: VERDE, rosso: ROSSO }
const euroIntero = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' } as Intl.NumberFormatOptions).format(n)

/** Un blocco del report, disegnato. */
function disegna(d: Documento, b: Blocco) {
  switch (b.tipo) {
    case 'sezione':
      return d.titoloSezione(b.titolo, b.nota)
    case 'sottotitolo':
      return d.sottotitolo(b.testo)
    case 'numeri':
      return d.numeri(b.voci)
    case 'tabella':
      return d.tabella(b.colonne, b.righe, b.totale)
    case 'barre':
      return d.barre(b.voci, { formato: b.formato === 'euro' ? euroIntero : numeroIt, colore: COLORI[b.colore] })
    case 'colonne':
      return d.colonne(b.etichette, b.serie.map((s) => ({ nome: s.nome, valori: s.valori, colore: COLORI[s.colore] })))
    case 'nota':
      return d.nota(b.testo)
  }
}

// ───────────────────────────────────────────────────────────── documento

function intestazione(d: Documento, r: ReportDati) {
  d.testo('RONCHIVERDI SPORT CLUB', MARGINE, d.y, { font: d.f.grassetto, size: 8, colore: ORO })
  d.y -= 26
  d.testo('Report', MARGINE, d.y, { font: d.f.serifGrassetto, size: 28 })
  d.y -= 20
  d.testo(`Dal ${dataEstesa(r.periodo.dal)} al ${dataEstesa(r.periodo.al)}`, MARGINE, d.y, { font: d.f.serif, size: 13 })
  d.y -= 14
  const giorni = `${numeroIt(r.periodo.giorni)} ${r.periodo.giorni === 1 ? 'giorno' : 'giorni'}`
  const confronto = r.periodo.precedente
    ? `Confronto con il periodo precedente: dal ${dataEstesa(r.periodo.precedente.dal)} al ${dataEstesa(r.periodo.precedente.al)}`
    : 'Nessun periodo precedente con dati per il confronto'
  d.testo(`${giorni}. ${confronto}.`, MARGINE, d.y, { size: 8, colore: GRIGIO })
  d.y -= 8
  d.linea(MARGINE, MARGINE + LARGHEZZA_UTILE, d.y, ORO, 2)
}

function piediDiPagina(d: Documento, r: ReportDati) {
  const pagine = d.doc.getPages()
  const generato = new Date(r.generato.il).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'long', timeStyle: 'short' })
  const testo = `Generato il ${generato}${r.generato.da ? ` da ${r.generato.da}` : ''}`
  pagine.forEach((p, i) => {
    p.drawLine({ start: { x: MARGINE, y: 38 }, end: { x: MARGINE + LARGHEZZA_UTILE, y: 38 }, thickness: 0.5, color: LINEA })
    p.drawText(d.pulito(testo, d.f.regolare), { x: MARGINE, y: 26, size: 7.5, font: d.f.regolare, color: GRIGIO })
    const n = `Pagina ${i + 1} di ${pagine.length}`
    const w = d.f.regolare.widthOfTextAtSize(n, 7.5)
    p.drawText(n, { x: MARGINE + LARGHEZZA_UTILE - w, y: 26, size: 7.5, font: d.f.regolare, color: GRIGIO })
  })
}

/** Il PDF del report: intestazione e blocchi (sintesi e sezioni scelte), con il piè di pagina su ogni pagina. */
export async function costruisciPdf(r: ReportDati): Promise<Uint8Array> {
  const d = await Documento.crea()
  d.doc.setTitle(`Report ${r.periodo.dal} - ${r.periodo.al}`)
  d.doc.setAuthor('Ronchiverdi Sport Club')
  d.doc.setCreator('CRM Ronchiverdi')
  intestazione(d, r)
  for (const blocco of costruisciBlocchi(r)) disegna(d, blocco)
  piediDiPagina(d, r)
  return d.doc.save()
}
