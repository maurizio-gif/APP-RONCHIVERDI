import { CUCITURA, SCRITTA, SPESSORE_CUCITURA, SPORT_CLUB } from '@/lib/avvio-logo'
import { FONDO_AVVIO, TAPPE, angoloPallina, cucituraDisegnata, dolce, fase, impulso, rallenta, scatta } from '@/lib/avvio'

// Il fotogramma dell'avvio animato (vedi lib/avvio.ts): tutto è una funzione
// pura del tempo `t`, quindi lo stesso fotogramma si può disegnare a
// qualunque istante, anche fermo — è così che si controlla l'animazione senza
// aspettarla. Canvas 2D, nessuna libreria.
//
// La pallina è una sfera vera: i punti della cucitura stanno sulla sfera, si
// ruotano attorno all'asse verticale e si proiettano, quindi la cucitura
// gira, si accorcia verso il bordo e sparisce dietro. A rotazione zero (cioè
// quando la pallina si ferma) la proiezione è esattamente il disegno del
// logo. Una seconda cucitura sul retro — la stessa ruotata di mezzo giro —
// fa sì che mentre gira se ne veda sempre una; sul fronte finito non si vede.

type Punto = readonly [number, number]
type Punto3 = { u: number; v: number; z: number }

export type Risorse = {
  scritta: HTMLCanvasElement
  sportClub: HTMLCanvasElement
  /** Un foglio su cui si mascherano le scritte (il bordo morbido della scrittura). */
  maschera: HTMLCanvasElement
  /** I puntini del feltro: sono sulla sfera, quindi girano con la pallina. */
  feltro: { u: number; v: number; z: number; raggio: number; chiaro: boolean }[]
  davanti: Punto3[]
  dietro: Punto3[]
}

// I colori: lo champagne dell'icona del CRM (design/icona-crm.jpeg).
const CHAMPAGNE_CHIARO = '#f1e8d0'
const CHAMPAGNE_MEDIO = '#d4c49b'
const CHAMPAGNE_SCURO = '#a89a76'
const SOLCO = '#16140f'

// ───────────────────────────────────────────────────────────── risorse

/** Una scritta bianca con trasparenza, tinta con un gradiente champagne. */
function tinta(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  g.globalCompositeOperation = 'source-in'
  const grad = g.createLinearGradient(0, 0, 0, c.height)
  grad.addColorStop(0, CHAMPAGNE_CHIARO)
  grad.addColorStop(1, CHAMPAGNE_MEDIO)
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  return c
}

function suSfera(p: Punto): Punto3 {
  const r = Math.hypot(p[0], p[1])
  // Gli estremi stanno sul bordo: si riportano esattamente sul cerchio unitario.
  const u = r > 1 ? p[0] / r : p[0]
  const v = r > 1 ? p[1] / r : p[1]
  return { u, v, z: Math.sqrt(Math.max(0, 1 - u * u - v * v)) }
}

/** Gli elementi che non cambiano da un fotogramma all'altro: si preparano una volta. */
export function preparaRisorse(
  scritta: CanvasImageSource & { width: number; height: number },
  sportClub: CanvasImageSource & { width: number; height: number }
): Risorse {
  const davanti = CUCITURA.map(suSfera)
  // La cucitura sul retro: la stessa, ruotata di mezzo giro attorno all'asse verticale.
  const dietro = davanti.map((p) => ({ u: -p.u, v: p.v, z: -p.z }))

  // Puntini del feltro: punti a caso sulla sfera (sempre gli stessi: il generatore è fisso).
  let seme = 20261029
  const caso = () => {
    seme = (seme * 1664525 + 1013904223) >>> 0
    return seme / 4294967296
  }
  const feltro = Array.from({ length: 240 }, () => {
    const z = caso() * 2 - 1
    const a = caso() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    return { u: r * Math.cos(a), v: z, z: r * Math.sin(a), raggio: 0.012 + caso() * 0.014, chiaro: caso() > 0.5 }
  })

  return { scritta: tinta(scritta), sportClub: tinta(sportClub), maschera: document.createElement('canvas'), feltro, davanti, dietro }
}

// ───────────────────────────────────────────────────────────── disegno

type Ruotato = { x: number; v: number; z: number }

/** Un punto della sfera dopo la rotazione di `teta` attorno all'asse verticale. */
function ruota(p: Punto3, teta: number): Ruotato {
  const c = Math.cos(teta)
  const s = Math.sin(teta)
  return { x: p.u * c + p.z * s, v: p.v, z: -p.u * s + p.z * c }
}

function discoMetallo(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, teta: number) {
  // Il metallo spazzolato dell'icona: un gradiente conico, che ruota pianissimo.
  if (typeof ctx.createConicGradient === 'function') {
    const g = ctx.createConicGradient(0.5 - teta * 0.04, cx, cy)
    const toni = [CHAMPAGNE_CHIARO, CHAMPAGNE_SCURO, CHAMPAGNE_CHIARO, CHAMPAGNE_MEDIO, CHAMPAGNE_SCURO, CHAMPAGNE_CHIARO, CHAMPAGNE_MEDIO, CHAMPAGNE_SCURO]
    toni.forEach((c, i) => g.addColorStop(i / toni.length, c))
    g.addColorStop(1, toni[0])
    ctx.fillStyle = g
  } else {
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R)
    g.addColorStop(0, CHAMPAGNE_CHIARO)
    g.addColorStop(1, CHAMPAGNE_SCURO)
    ctx.fillStyle = g
  }
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
}

function cuciture(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, teta: number, p: number, ris: Risorse) {
  if (p <= 0) return
  const N = ris.davanti.length
  const limite = Math.min(1, p) * (N - 1)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const copia of [ris.dietro, ris.davanti]) {
    const P = copia.map((q) => ruota(q, teta))
    // Prima il filo chiaro (il bordo che prende luce), poi il solco scuro: due passate sulla stessa linea.
    for (const passata of ['luce', 'solco'] as const) {
      for (let i = 0; i < N - 1 && i < limite; i++) {
        let a = P[i]
        let b = P[i + 1]
        // L'ultimo tratto arriva solo fin dove la cucitura è disegnata.
        if (limite - i < 1) b = { x: a.x + (b.x - a.x) * (limite - i), v: a.v + (b.v - a.v) * (limite - i), z: a.z + (b.z - a.z) * (limite - i) }
        if (a.z <= 0 && b.z <= 0) continue
        // Un tratto a cavallo del bordo si taglia dove passa dietro.
        if (a.z <= 0) a = { x: a.x + (b.x - a.x) * (-a.z / (b.z - a.z)), v: a.v + (b.v - a.v) * (-a.z / (b.z - a.z)), z: 0 }
        else if (b.z <= 0) b = { x: a.x + (b.x - a.x) * (a.z / (a.z - b.z)), v: a.v + (b.v - a.v) * (a.z / (a.z - b.z)), z: 0 }
        // Il tratto si stringe verso il bordo, come una striscia che gira dietro.
        const scorcio = Math.pow(Math.max((a.z + b.z) / 2, 0.1), 0.65)
        const spessore = SPESSORE_CUCITURA * R * scorcio
        ctx.beginPath()
        if (passata === 'luce') {
          ctx.strokeStyle = 'rgba(255, 250, 235, 0.42)'
          ctx.lineWidth = spessore + R * 0.028
          ctx.moveTo(cx + a.x * R + R * 0.012, cy + a.v * R + R * 0.014)
          ctx.lineTo(cx + b.x * R + R * 0.012, cy + b.v * R + R * 0.014)
        } else {
          ctx.strokeStyle = SOLCO
          ctx.lineWidth = spessore
          ctx.moveTo(cx + a.x * R, cy + a.v * R)
          ctx.lineTo(cx + b.x * R, cy + b.v * R)
        }
        ctx.stroke()
      }
    }
  }
}

/** La punta luminosa della «penna» che disegna la cucitura. */
function puntaPenna(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, teta: number, p: number, ris: Risorse) {
  if (p <= 0.003 || p >= 0.997) return
  const N = ris.davanti.length
  const x = Math.min(1, p) * (N - 1)
  const i = Math.floor(x)
  const f = x - i
  for (const copia of [ris.davanti, ris.dietro]) {
    const a = ruota(copia[i], teta)
    const b = ruota(copia[Math.min(i + 1, N - 1)], teta)
    const q = { x: a.x + (b.x - a.x) * f, v: a.v + (b.v - a.v) * f, z: a.z + (b.z - a.z) * f }
    if (q.z < 0.12) continue
    const px = cx + q.x * R
    const py = cy + q.v * R
    const g = ctx.createRadialGradient(px, py, 0, px, py, R * 0.2)
    g.addColorStop(0, 'rgba(255, 244, 214, 0.95)')
    g.addColorStop(0.25, 'rgba(240, 214, 150, 0.45)')
    g.addColorStop(1, 'rgba(240, 214, 150, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, R * 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function pallina(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, ris: Risorse) {
  const teta = angoloPallina(t)
  const p = cucituraDisegnata(t)
  const feltro = 1 - fase(t, TAPPE.assestaDa, 650)
  // La luce e l'ombra della sfera si attenuano mentre si ferma sul logo, che è un disegno.
  const rilievo = 0.55 + 0.45 * feltro

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()

  discoMetallo(ctx, cx, cy, R, teta)

  // Il feltro: puntini sulla sfera, che girano con lei.
  if (feltro > 0.01) {
    for (const f of ris.feltro) {
      const q = ruota({ u: f.u, v: f.v, z: f.z }, teta)
      if (q.z < 0.04) continue
      ctx.fillStyle = f.chiaro ? `rgba(255, 252, 240, ${0.28 * feltro * q.z})` : `rgba(70, 58, 34, ${0.22 * feltro * q.z})`
      ctx.beginPath()
      ctx.arc(cx + q.x * R, cy + q.v * R, f.raggio * R * (0.5 + 0.5 * q.z), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  cuciture(ctx, cx, cy, R, teta, p, ris)

  // La luce, ferma in alto a sinistra: la sfera gira, la luce no.
  const luce = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, 0, cx - R * 0.38, cy - R * 0.42, R * 1.05)
  luce.addColorStop(0, `rgba(255, 252, 240, ${0.5 * rilievo})`)
  luce.addColorStop(0.5, `rgba(255, 252, 240, ${0.1 * rilievo})`)
  luce.addColorStop(1, 'rgba(255, 252, 240, 0)')
  ctx.fillStyle = luce
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  // L'ombra sul bordo: da qui la sfera sembra tonda.
  const bordo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R)
  bordo.addColorStop(0, 'rgba(12, 10, 6, 0)')
  bordo.addColorStop(1, `rgba(12, 10, 6, ${0.5 * rilievo})`)
  ctx.fillStyle = bordo
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)

  puntaPenna(ctx, cx, cy, R, teta, p, ris)

  // Il riflesso: un passaggio lento sulla pallina ferma.
  const r = fase(t, TAPPE.riflessoDa, TAPPE.riflessoA - TAPPE.riflessoDa)
  if (r > 0 && r < 1) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.5)
    const x = (-1.7 + 3.4 * rallenta(r)) * R
    const g = ctx.createLinearGradient(x - R * 0.3, 0, x + R * 0.3, 0)
    g.addColorStop(0, 'rgba(255, 255, 255, 0)')
    g.addColorStop(0.5, `rgba(255, 255, 255, ${0.5 * Math.sin(Math.PI * r)})`)
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(x - R * 0.3, -R * 2, R * 0.6, R * 4)
    ctx.restore()
  }
  ctx.restore()

  // Il filo del bordo.
  ctx.strokeStyle = 'rgba(255, 250, 235, 0.22)'
  ctx.lineWidth = Math.max(1, R * 0.012)
  ctx.beginPath()
  ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, Math.PI * 2)
  ctx.stroke()
}

/** La scritta che si scrive da sinistra a destra, con il bordo morbido e una luce sulla punta. */
function scrittaScritta(ctx: CanvasRenderingContext2D, ris: Risorse, x0: number, y0: number, w: number, h: number, t: number) {
  const pr = dolce(fase(t, TAPPE.scrittaDa, TAPPE.scrittaA - TAPPE.scrittaDa))
  if (pr <= 0) return
  const src = ris.scritta
  const m = ris.maschera
  if (m.width !== src.width || m.height !== src.height) {
    m.width = src.width
    m.height = src.height
  }
  const g = m.getContext('2d')!
  g.globalCompositeOperation = 'source-over'
  g.clearRect(0, 0, m.width, m.height)
  g.drawImage(src, 0, 0)
  const morbido = m.width * 0.12
  const bordo = (m.width + morbido) * pr
  g.globalCompositeOperation = 'destination-in'
  const mask = g.createLinearGradient(bordo - morbido, 0, bordo, 0)
  mask.addColorStop(0, 'rgba(0,0,0,1)')
  mask.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = mask
  g.fillRect(0, 0, m.width, m.height)
  g.globalCompositeOperation = 'source-over'

  ctx.drawImage(m, x0, y0, w, h)
  // La punta luminosa della «penna», che segue il bordo della scrittura.
  if (pr < 0.97) {
    const px = Math.min(x0 + (bordo / m.width) * w - (morbido / m.width) * w * 0.35, x0 + w)
    const py = y0 + h * 0.5
    // Si accende all'inizio e si spegne prima della fine: a scrittura finita non resta nessun alone.
    const intensita = Math.pow(Math.sin(Math.PI * Math.min(pr / 0.97, 1)), 0.7)
    const raggio = h * 0.38
    const gl = ctx.createRadialGradient(px, py, 0, px, py, raggio)
    gl.addColorStop(0, `rgba(255, 244, 214, ${0.34 * intensita})`)
    gl.addColorStop(0.45, `rgba(240, 214, 150, ${0.1 * intensita})`)
    gl.addColorStop(1, 'rgba(240, 214, 150, 0)')
    ctx.fillStyle = gl
    ctx.fillRect(px - raggio, py - raggio, raggio * 2, raggio * 2)
  }
}

/** Il fotogramma all'istante `t` (ms), su un'area di `W` x `H` pixel CSS. */
export function disegnaAvvio(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, ris: Risorse, uscita = 0): void {
  // Il fondo.
  ctx.fillStyle = FONDO_AVVIO
  ctx.fillRect(0, 0, W, H)

  // Le misure: il logo finito sta al centro dello schermo; più piccolo sui telefoni stretti.
  const larghezzaLogo = SCRITTA[2] - SCRITTA[0]
  const altezzaLogo = SPORT_CLUB[3] + 1
  const R = Math.min((W * 0.8) / larghezzaLogo, (H * 0.5) / altezzaLogo, 150)
  const cxFinale = W / 2 - (R * (SCRITTA[0] + SCRITTA[2])) / 2
  const cyFinale = H / 2 - (R * (altezzaLogo - 2)) / 2
  // All'inizio la pallina è grande e al centro dello schermo.
  const Riniziale = Math.min(R * 1.55, Math.min(W, H) * 0.3)
  const a = rallenta(fase(t, TAPPE.assestaDa, TAPPE.assestaA - TAPPE.assestaDa))
  const cx = W / 2 + (cxFinale - W / 2) * a
  const cy = H / 2 + (cyFinale - H / 2) * a
  const Rp = Riniziale + (R - Riniziale) * a

  ctx.save()
  // Nell'uscita la scena si ingrandisce un poco, dal centro.
  const ingrandimento = 1 + 0.05 * rallenta(uscita)
  ctx.translate(W / 2, H / 2)
  ctx.scale(ingrandimento, ingrandimento)
  ctx.translate(-W / 2, -H / 2)

  // L'alone caldo dietro la pallina, che si accende allo scatto.
  const alone = (0.45 + 0.55 * rallenta(fase(t, 0, 900))) * (1 + 0.5 * impulso(t, TAPPE.scatto, 260))
  const gAlone = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rp * 3.2)
  gAlone.addColorStop(0, `rgba(214, 186, 120, ${0.26 * Math.min(1.4, alone)})`)
  gAlone.addColorStop(0.45, `rgba(190, 160, 96, ${0.08 * Math.min(1.4, alone)})`)
  gAlone.addColorStop(1, 'rgba(190, 160, 96, 0)')
  ctx.fillStyle = gAlone
  ctx.fillRect(0, 0, W, H)

  // La pallina compare, liscia, e comincia a girare.
  const comparsa = rallenta(fase(t, 120, 520))
  if (comparsa > 0) {
    ctx.save()
    ctx.globalAlpha = comparsa
    const Rc = Rp * (0.82 + 0.18 * comparsa)
    pallina(ctx, cx, cy, Rc, t, ris)
    ctx.restore()
  }

  // L'anello sottile dello scatto: un filo che si allarga e svanisce.
  const anello = fase(t, TAPPE.scatto, 1100)
  if (anello > 0 && anello < 1) {
    ctx.strokeStyle = `rgba(232, 214, 168, ${0.5 * Math.pow(1 - anello, 1.6)})`
    ctx.lineWidth = 1.4 * (1 - anello) + 0.4
    ctx.beginPath()
    ctx.arc(cx, cy, Rp * (1.04 + 1.1 * scatta(anello)), 0, Math.PI * 2)
    ctx.stroke()
  }

  // Le scritte, sotto la pallina ferma.
  if (t >= TAPPE.scrittaDa) {
    const x0 = cxFinale + R * SCRITTA[0]
    const y0 = cyFinale + R * SCRITTA[1]
    scrittaScritta(ctx, ris, x0, y0, R * (SCRITTA[2] - SCRITTA[0]), R * (SCRITTA[3] - SCRITTA[1]), t)

    const s = rallenta(fase(t, TAPPE.sportClubDa, TAPPE.sportClubA - TAPPE.sportClubDa))
    if (s > 0) {
      ctx.save()
      ctx.globalAlpha = s
      ctx.drawImage(
        ris.sportClub,
        cxFinale + R * SPORT_CLUB[0],
        cyFinale + R * SPORT_CLUB[1] + R * 0.14 * (1 - s),
        R * (SPORT_CLUB[2] - SPORT_CLUB[0]),
        R * (SPORT_CLUB[3] - SPORT_CLUB[1])
      )
      ctx.restore()
    }
  }
  ctx.restore()
}
