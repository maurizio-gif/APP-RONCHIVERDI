'use client'

import { useEffect, useRef, useState } from 'react'
import { DURATA_MS, DURATA_RIDOTTA_MS, TAPPE, fase, uscita } from '@/lib/avvio'
import { disegnaAvvio, preparaRisorse } from '@/lib/avvio-disegno'

// L'avvio animato del CRM: la pallina del logo gira su se stessa e, girando,
// compone il logo. Le regole (una volta per apertura, un tocco lo salta,
// «riduci movimento») e la ragione del fondo scuro prima del codice stanno in
// lib/avvio.ts; il disegno di ogni fotogramma in lib/avvio-disegno.ts.
//
// Se parte lo decide lo script nel <head> (SCRIPT_AVVIO), che mette
// `data-avvio` su <html> prima del primo disegno: da lì un velo scuro copre la
// pagina (vedi globals.css). Questo componente non ripete la decisione: guarda
// l'attributo, e quando ha finito — o appena comincia a uscire — lo toglie.

const IMMAGINI = ['/avvio/scritta.png', '/avvio/sportclub.png']

function carica(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Immagine non caricata: ${src}`))
    img.src = src
  })
}

function togliVelo() {
  document.documentElement.removeAttribute('data-avvio')
}

export function AvvioAnimato() {
  const [attivo, setAttivo] = useState(false)
  useEffect(() => {
    if (document.documentElement.getAttribute('data-avvio') === '1') setAttivo(true)
  }, [])
  if (!attivo) return null
  return <Scena onFine={() => setAttivo(false)} />
}

function Scena({ onFine }: { onFine: () => void }) {
  const contenitore = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  // Il momento (ms dall'inizio) in cui lo si è saltato, se lo si è saltato.
  const salto = useRef<number | null>(null)
  const orologio = useRef(0)

  useEffect(() => {
    const cv = tela.current
    const box = contenitore.current
    const ctx = cv?.getContext('2d')
    if (!cv || !box || !ctx) {
      togliVelo()
      onFine()
      return
    }
    const ridotto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const durata = ridotto ? DURATA_RIDOTTA_MS : DURATA_MS
    let id = 0
    let chiuso = false
    let W = 0
    let H = 0

    const misura = () => {
      W = window.innerWidth
      H = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      cv.style.width = `${W}px`
      cv.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    misura()
    window.addEventListener('resize', misura)

    const finisci = () => {
      if (chiuso) return
      chiuso = true
      togliVelo()
      onFine()
    }
    const salta = () => {
      if (salto.current === null && !ridotto) salto.current = orologio.current
    }
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') salta()
    }
    window.addEventListener('keydown', tasto)

    // Una rete di sicurezza: qualunque cosa succeda, il CRM non resta sotto il sipario.
    const sicurezza = window.setTimeout(finisci, durata + 4000)

    let ris: ReturnType<typeof preparaRisorse> | null = null
    Promise.all(IMMAGINI.map(carica))
      .then(([scritta, sportClub]) => {
        if (chiuso) return
        ris = preparaRisorse(scritta, sportClub)
        const partenza = performance.now()
        const giro = () => {
          const ms = performance.now() - partenza
          orologio.current = ms
          // Con «riduci movimento» la scena è sempre quella finita, che entra ed esce in dissolvenza.
          const t = ridotto ? TAPPE.uscitaDa - 50 : ms
          const u = ridotto ? fase(ms, 1250, 250) : uscita(ms, salto.current)
          const ingresso = ridotto ? fase(ms, 0, 250) : 1
          disegnaAvvio(ctx, t, W, H, ris!, ridotto ? 0 : u)
          box.style.opacity = String(ingresso * (1 - u))
          // Appena comincia a uscire il velo non serve più: sotto c'è già la pagina.
          if (u > 0) togliVelo()
          const termine = salto.current !== null ? salto.current + 320 : durata
          if (ms >= termine) finisci()
          else id = requestAnimationFrame(giro)
        }
        id = requestAnimationFrame(giro)
      })
      .catch(() => finisci())

    return () => {
      chiuso = true
      cancelAnimationFrame(id)
      window.clearTimeout(sicurezza)
      window.removeEventListener('resize', misura)
      window.removeEventListener('keydown', tasto)
      // Il velo non si toglie qui: in sviluppo React monta, smonta e rimonta
      // il componente, e il primo smontaggio scoprirebbe la pagina a metà.
      // Lo tolgono `finisci` e la rete di sicurezza dello script nel <head>.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={contenitore}
      className="avvio"
      role="button"
      tabIndex={-1}
      aria-label="Ronchiverdi Sport Club. Tocca per continuare."
      onPointerDown={() => {
        if (salto.current === null) salto.current = orologio.current
      }}
    >
      <canvas ref={tela} aria-hidden="true" />
    </div>
  )
}
