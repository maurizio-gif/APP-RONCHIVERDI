import { deflateRawSync } from 'node:zlib'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { etichettaIntervallo, numero } from '@/lib/accessi'
import { descriviIngressi, descriviNominativi, fogliDelReport, type Cella, type Foglio, type ReportAccessi } from '@/lib/accessi-report'

// I file del report accessi: CSV, Excel (.xlsx) e PDF. Tutto scritto a mano,
// JavaScript puro e nessuna dipendenza in più (come lib/report-pdf.ts): gira
// identico su Vercel e in locale.

// ───────────────────────────────────────────────────────────────── CSV

function cellaCsv(valore: Cella): string {
  const testo = valore == null ? '' : String(valore)
  // Un testo che comincia con = + - @ Excel lo legge come formula: nomi e
  // descrizioni sono testo libero.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

/** Separatore «;» e BOM, perché Excel in italiano apra il file con le colonne e gli accenti giusti. */
export function costruisciCsv(report: ReportAccessi): string {
  const righe: string[] = []
  for (const f of fogliDelReport(report)) {
    if (righe.length > 0) righe.push('')
    righe.push(cellaCsv(f.titolo.toUpperCase()))
    righe.push(f.intestazioni.map(cellaCsv).join(';'))
    for (const r of f.righe) righe.push(r.map(cellaCsv).join(';'))
    if (f.nota) righe.push(cellaCsv(f.nota))
  }
  return '﻿' + righe.join('\r\n')
}

// ──────────────────────────────────────────────────────────────── Excel

const CRC_TABELLA = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(dati: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < dati.length; i++) c = CRC_TABELLA[(c ^ dati[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Uno zip con i file compressi (deflate): un .xlsx è questo. */
function zip(file: { nome: string; dati: Buffer }[]): Buffer {
  const parti: Buffer[] = []
  const directory: Buffer[] = []
  let posizione = 0
  // Data e ora MS-DOS fisse: il contenuto è lo stesso a ogni scarico.
  const ora = 0
  const data = (46 << 9) | (1 << 5) | 1
  for (const f of file) {
    const nome = Buffer.from(f.nome, 'utf8')
    const compressi = deflateRawSync(f.dati)
    const crc = crc32(f.dati)

    const locale = Buffer.alloc(30)
    locale.writeUInt32LE(0x04034b50, 0)
    locale.writeUInt16LE(20, 4)
    locale.writeUInt16LE(0x0800, 6)
    locale.writeUInt16LE(8, 8)
    locale.writeUInt16LE(ora, 10)
    locale.writeUInt16LE(data, 12)
    locale.writeUInt32LE(crc, 14)
    locale.writeUInt32LE(compressi.length, 18)
    locale.writeUInt32LE(f.dati.length, 22)
    locale.writeUInt16LE(nome.length, 26)
    locale.writeUInt16LE(0, 28)

    const centrale = Buffer.alloc(46)
    centrale.writeUInt32LE(0x02014b50, 0)
    centrale.writeUInt16LE(20, 4)
    centrale.writeUInt16LE(20, 6)
    centrale.writeUInt16LE(0x0800, 8)
    centrale.writeUInt16LE(8, 10)
    centrale.writeUInt16LE(ora, 12)
    centrale.writeUInt16LE(data, 14)
    centrale.writeUInt32LE(crc, 16)
    centrale.writeUInt32LE(compressi.length, 20)
    centrale.writeUInt32LE(f.dati.length, 24)
    centrale.writeUInt16LE(nome.length, 28)
    centrale.writeUInt32LE(posizione, 42)

    parti.push(locale, nome, compressi)
    directory.push(centrale, nome)
    posizione += locale.length + nome.length + compressi.length
  }
  const dir = Buffer.concat(directory)
  const fine = Buffer.alloc(22)
  fine.writeUInt32LE(0x06054b50, 0)
  fine.writeUInt16LE(file.length, 8)
  fine.writeUInt16LE(file.length, 10)
  fine.writeUInt32LE(dir.length, 12)
  fine.writeUInt32LE(posizione, 16)
  return Buffer.concat([...parti, dir, fine])
}

function xml(testo: string): string {
  return testo
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function colonna(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// Stili: 1 = intestazione (grassetto, fondo), 2 = titolo, 3 = totale (grassetto), 4 = nota (corsivo).
const STILI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B6A60"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE3C7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function cellaXlsx(valore: Cella, riga: number, col: number, stile: number): string {
  const rif = `${colonna(col)}${riga}`
  const s = stile ? ` s="${stile}"` : ''
  if (typeof valore === 'number' && Number.isFinite(valore)) return `<c r="${rif}"${s}><v>${valore}</v></c>`
  if (valore == null || valore === '') return stile ? `<c r="${rif}"${s}/>` : ''
  return `<c r="${rif}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(String(valore))}</t></is></c>`
}

function fogliolXlsx(f: Foglio): string {
  const righe: string[] = []
  let n = 1
  righe.push(`<row r="${n}">${cellaXlsx(f.titolo, n, 0, 2)}</row>`)
  n += 2
  righe.push(`<row r="${n}">${f.intestazioni.map((t, i) => cellaXlsx(t, n, i, 1)).join('')}</row>`)
  const ultimaDati = f.righe.length
  f.righe.forEach((r, i) => {
    n++
    // Le righe di totale («Totale…») in grassetto.
    const totale = i === ultimaDati - 1 && typeof r[0] === 'string' && /^Totale/.test(r[0])
    righe.push(`<row r="${n}">${r.map((c, k) => cellaXlsx(c, n, k, totale ? 3 : 0)).join('')}</row>`)
  })
  if (f.nota) {
    n += 2
    righe.push(`<row r="${n}">${cellaXlsx(f.nota, n, 0, 4)}</row>`)
  }
  const somma = f.larghezze.reduce((a, b) => a + b, 0)
  // Larghezza totale di circa 100 caratteri, divisa secondo i pesi.
  const colonne = f.larghezze
    .map((p, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(10, Math.round((p / somma) * 100))}" customWidth="1"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colonne}</cols><sheetData>${righe.join('')}</sheetData></worksheet>`
}

export function costruisciXlsx(report: ReportAccessi): Buffer {
  const fogli = fogliDelReport(report)
  const file = [
    {
      nome: '[Content_Types].xml',
      dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${fogli
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      nome: '_rels/.rels',
      dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nome: 'xl/workbook.xml',
      dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fogli
        .map((f, i) => `<sheet name="${xml(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nome: 'xl/styles.xml', dati: STILI },
    ...fogli.map((f, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dati: fogliolXlsx(f) })),
  ].map((f) => ({ nome: f.nome, dati: Buffer.from(f.dati, 'utf8') }))
  return zip(file)
}

// ────────────────────────────────────────────────────────────────── PDF

const A4 = { larghezza: 595.28, altezza: 841.89 }
const MARGINE = 44
const MARGINE_BASSO = 52
const LARGHEZZA_UTILE = A4.larghezza - MARGINE * 2
const ORO = rgb(0.545, 0.424, 0.078)
const INCHIOSTRO = rgb(0.09, 0.09, 0.06)
const GRIGIO = rgb(0.43, 0.42, 0.38)
const LINEA = rgb(0.87, 0.85, 0.79)
const FONDO = rgb(0.975, 0.955, 0.91)
const ALTEZZA_RIGA = 16
/** Oltre queste righe il PDF rimanda al file Excel: un elenco di migliaia di nominativi non si legge su carta. */
const MASSIMO_RIGHE_PDF = 3000

/** Il testo come lo sa scrivere un font standard: le lettere fuori dal set diventano «?». */
function pulito(testo: string, font: PDFFont): string {
  const ammessi = new Set(font.getCharacterSet())
  const sostituzioni: Record<string, string> = { '×': 'x', '−': '-', '’': "'", '‘': "'", '–': '-', '…': '...' }
  let fuori = ''
  for (const c of testo.normalize('NFC')) {
    const s = sostituzioni[c] ?? c
    for (const x of s) fuori += ammessi.has(x.codePointAt(0)!) ? x : '?'
  }
  return fuori
}

/** Accorcia il testo con «...» finché sta nella larghezza. */
function adatta(testo: string, font: PDFFont, size: number, larghezza: number): string {
  let t = pulito(testo, font)
  if (font.widthOfTextAtSize(t, size) <= larghezza) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > larghezza) t = t.slice(0, -1)
  return t + '...'
}

function righeA(testo: string, font: PDFFont, size: number, larghezza: number): string[] {
  const parole = pulito(testo, font).split(/\s+/)
  const righe: string[] = []
  let corrente = ''
  for (const p of parole) {
    const prova = corrente ? `${corrente} ${p}` : p
    if (font.widthOfTextAtSize(prova, size) > larghezza && corrente) {
      righe.push(corrente)
      corrente = p
    } else corrente = prova
  }
  if (corrente) righe.push(corrente)
  return righe
}

export async function costruisciPdf(report: ReportAccessi, generatoIl: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const regolare = await doc.embedFont(StandardFonts.Helvetica)
  const grassetto = await doc.embedFont(StandardFonts.HelveticaBold)
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold)

  let pagina!: PDFPage
  let y = 0
  const nuovaPagina = () => {
    pagina = doc.addPage([A4.larghezza, A4.altezza])
    y = A4.altezza - MARGINE
  }
  const assicura = (altezza: number) => {
    if (y - altezza < MARGINE_BASSO) nuovaPagina()
  }
  nuovaPagina()

  pagina.drawText('RONCHIVERDI', { x: MARGINE, y, size: 9, font: grassetto, color: ORO })
  y -= 24
  pagina.drawText(pulito('Report ingressi', serif), { x: MARGINE, y, size: 22, font: serif, color: INCHIOSTRO })
  y -= 20
  const intestazione: [string, string][] = [
    ['Periodo', etichettaIntervallo(report.dal, report.al)],
    ['Ingressi', descriviIngressi(report)],
    ['Nominativi', descriviNominativi(report)],
  ]
  for (const [voce, valore] of intestazione) {
    const righe = righeA(valore, regolare, 10, LARGHEZZA_UTILE - 70)
    pagina.drawText(voce, { x: MARGINE, y, size: 10, font: grassetto, color: GRIGIO })
    righe.slice(0, 4).forEach((r, i) => pagina.drawText(r, { x: MARGINE + 70, y: y - i * 13, size: 10, font: regolare, color: INCHIOSTRO }))
    y -= Math.max(1, Math.min(righe.length, 4)) * 13 + 3
  }
  y -= 8

  // I quattro numeri in testa.
  const numeri: [string, number][] = [
    ['Passaggi', report.totali.passaggi],
    ['Teste', report.totali.teste],
    ['Visite', report.totali.visite],
    ['Giorni con passaggi', report.totali.giorniAperti],
  ]
  const larghezzaNumero = (LARGHEZZA_UTILE - 3 * 8) / 4
  numeri.forEach(([etichetta, valore], i) => {
    const x = MARGINE + i * (larghezzaNumero + 8)
    pagina.drawRectangle({ x, y: y - 46, width: larghezzaNumero, height: 46, color: FONDO, borderColor: LINEA, borderWidth: 0.5 })
    pagina.drawText(pulito(numero(valore), serif), { x: x + 10, y: y - 28, size: 18, font: serif, color: INCHIOSTRO })
    pagina.drawText(pulito(etichetta, regolare), { x: x + 10, y: y - 40, size: 8, font: regolare, color: GRIGIO })
  })
  y -= 64

  for (const f of fogliDelReport(report).filter((x) => x.nome !== 'Riepilogo')) {
    assicura(70)
    pagina.drawText(pulito(f.titolo, serif), { x: MARGINE, y, size: 14, font: serif, color: INCHIOSTRO })
    y -= 8
    const somma = f.larghezze.reduce((a, b) => a + b, 0)
    const larghezze = f.larghezze.map((p) => (p / somma) * LARGHEZZA_UTILE)
    const allineaDestra = f.intestazioni.map((_, i) => f.righe.some((r) => typeof r[i] === 'number'))
    const disegnaRiga = (celle: Cella[], font: PDFFont, fondo: boolean) => {
      y -= ALTEZZA_RIGA
      if (fondo) pagina.drawRectangle({ x: MARGINE, y: y - 4, width: LARGHEZZA_UTILE, height: ALTEZZA_RIGA, color: FONDO })
      let x = MARGINE
      celle.forEach((c, i) => {
        const testo = c == null ? '' : typeof c === 'number' ? numero(c) : c
        const t = adatta(testo, font, 9, larghezze[i] - 8)
        const xTesto = allineaDestra[i] ? x + larghezze[i] - 4 - font.widthOfTextAtSize(t, 9) : x + 4
        pagina.drawText(t, { x: xTesto, y, size: 9, font, color: INCHIOSTRO })
        x += larghezze[i]
      })
      pagina.drawLine({ start: { x: MARGINE, y: y - 4 }, end: { x: MARGINE + LARGHEZZA_UTILE, y: y - 4 }, thickness: 0.4, color: LINEA })
    }
    const intesta = () => disegnaRiga(f.intestazioni, grassetto, true)
    intesta()

    const daMostrare = f.righe.slice(0, MASSIMO_RIGHE_PDF)
    daMostrare.forEach((r, i) => {
      if (y - ALTEZZA_RIGA < MARGINE_BASSO) {
        nuovaPagina()
        intesta()
      }
      const totale = i === f.righe.length - 1 && typeof r[0] === 'string' && /^Totale/.test(r[0])
      disegnaRiga(r, totale ? grassetto : regolare, false)
    })
    if (f.righe.length > daMostrare.length) {
      assicura(ALTEZZA_RIGA)
      y -= ALTEZZA_RIGA
      pagina.drawText(pulito(`Mostrate le prime ${numero(daMostrare.length)} righe su ${numero(f.righe.length)}: l'elenco completo è nel file Excel o CSV.`, regolare), {
        x: MARGINE,
        y,
        size: 9,
        font: regolare,
        color: GRIGIO,
      })
    }
    if (f.nota) {
      for (const riga of righeA(f.nota, regolare, 8.5, LARGHEZZA_UTILE)) {
        assicura(12)
        y -= 12
        pagina.drawText(riga, { x: MARGINE, y, size: 8.5, font: regolare, color: GRIGIO })
      }
    }
    y -= 22
  }

  const pagine = doc.getPages()
  pagine.forEach((p, i) => {
    p.drawText(pulito(`Generato il ${generatoIl} · pagina ${i + 1} di ${pagine.length}`, regolare), {
      x: MARGINE,
      y: 28,
      size: 8,
      font: regolare,
      color: GRIGIO,
    })
  })
  return doc.save()
}
