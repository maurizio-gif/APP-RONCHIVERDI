'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Il suono dell'avviso, generato con WebAudio e non da un file.
//
// Due ragioni: non serve un asset binario da versionare e servire, e un tono
// costruito qui si può tenere breve e discreto — un mp3 scaricato da qualche
// parte finisce sempre per essere troppo lungo o troppo allegro per una
// segreteria dove ci sono i soci davanti al banco.
//
// I browser bloccano l'audio finché l'utente non ha interagito con la pagina:
// l'AudioContext si crea al primo clic o tasto premuto, non al montaggio. Chi
// sta lavorando nel pannello ha già cliccato qualcosa, quindi in pratica è
// sempre pronto; e se non lo è, il popup compare comunque — il suono è
// l'accessorio, l'avviso visivo è la sostanza.

const CHIAVE_PREFERENZA = 'rv-avviso-sonoro'

/** Due note brevi in salita: si notano senza far sobbalzare nessuno. */
const NOTE = [
  { frequenza: 880, inizio: 0, durata: 0.16 },
  { frequenza: 1174.7, inizio: 0.18, durata: 0.26 },
]

export function useAvvisoSonoro() {
  // Attivo per scelta predefinita: un avviso che va acceso non avvisa
  // nessuno il giorno in cui serve. Si spegne, e la scelta resta su questo
  // browser.
  const [attivo, setAttivo] = useState(true)
  const contesto = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (localStorage.getItem(CHIAVE_PREFERENZA) === 'no') setAttivo(false)
  }, [])

  // L'AudioContext si può creare solo dopo un'interazione: si aggancia al
  // primo clic o tasto e poi si smette di ascoltare.
  useEffect(() => {
    function prepara() {
      if (!contesto.current) {
        const Costruttore =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Costruttore) contesto.current = new Costruttore()
      }
      rimuovi()
    }
    function rimuovi() {
      document.removeEventListener('pointerdown', prepara)
      document.removeEventListener('keydown', prepara)
    }
    document.addEventListener('pointerdown', prepara)
    document.addEventListener('keydown', prepara)
    return rimuovi
  }, [])

  const suona = useCallback(() => {
    const ctx = contesto.current
    if (!ctx) return
    // Una scheda in secondo piano sospende il contesto: si riprende, o il
    // suono partirebbe muto proprio quando serve — l'avviso interessa
    // soprattutto a chi non sta guardando questa scheda.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    const adesso = ctx.currentTime
    for (const nota of NOTE) {
      const oscillatore = ctx.createOscillator()
      const volume = ctx.createGain()
      oscillatore.type = 'sine'
      oscillatore.frequency.value = nota.frequenza

      // Attacco e rilascio morbidi: un'onda troncata di netto fa "clic".
      const da = adesso + nota.inizio
      const a = da + nota.durata
      volume.gain.setValueAtTime(0, da)
      volume.gain.linearRampToValueAtTime(0.16, da + 0.02)
      volume.gain.exponentialRampToValueAtTime(0.0001, a)

      oscillatore.connect(volume).connect(ctx.destination)
      oscillatore.start(da)
      oscillatore.stop(a + 0.02)
    }
  }, [])

  const cambia = useCallback((valore: boolean) => {
    setAttivo(valore)
    localStorage.setItem(CHIAVE_PREFERENZA, valore ? 'si' : 'no')
  }, [])

  return {
    attivo,
    cambia,
    /** Suona solo se l'avviso sonoro è attivo su questo browser. */
    avvisa: useCallback(() => {
      if (attivo) suona()
    }, [attivo, suona]),
    /** Suona a prescindere: serve al pulsante «prova». */
    provaSuono: suona,
  }
}
