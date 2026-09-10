'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

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

// ── La preferenza, in un modulo e non in uno stato per componente ──
//
// Da quando il campanello sta anche in cima al menu, gli interruttori sono
// due — quello del menu e quello dentro il popup — e sono due viste della
// stessa cosa. Con uno `useState` per istanza, spegnerlo dal popup lasciava
// il menu acceso fino al ricaricamento: due interruttori che dicono cose
// diverse sulla stessa preferenza sono peggio di un interruttore solo nel
// posto sbagliato.
//
// Attivo per scelta predefinita: un avviso che va acceso non avvisa nessuno
// il giorno in cui serve. Si spegne, e la scelta resta su questo browser.
let attivoCorrente = true
let letto = false
const ascoltatori = new Set<() => void>()

function leggiPreferenza(): boolean {
  if (!letto) {
    letto = true
    try {
      attivoCorrente = window.localStorage.getItem(CHIAVE_PREFERENZA) !== 'no'
    } catch {
      // Navigazione privata o storage pieno: resta il predefinito.
    }
  }
  return attivoCorrente
}

function sottoscrivi(notifica: () => void) {
  ascoltatori.add(notifica)
  return () => {
    ascoltatori.delete(notifica)
  }
}

function impostaPreferenza(valore: boolean) {
  letto = true
  attivoCorrente = valore
  try {
    window.localStorage.setItem(CHIAVE_PREFERENZA, valore ? 'si' : 'no')
  } catch {
    // Vale per questa sessione e basta, che è meglio di un errore in faccia.
  }
  for (const notifica of ascoltatori) notifica()
}

// Sul server la preferenza non si può leggere: si dichiara il predefinito, e
// `useSyncExternalStore` si occupa di riallineare il primo render del browser
// senza far gridare all'errore di idratazione.
function preferenzaSulServer() {
  return true
}

// ── Il suono ──
//
// Il contesto audio è uno per pagina e non uno per componente: da quando i
// posti che lo usano sono due, due contesti vorrebbero dire due volte lo
// sblocco al primo gesto e due volte la memoria che il browser gli riserva.
let contesto: AudioContext | null = null

function ottieniContesto(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (contesto) return contesto
  const Costruttore =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Costruttore) contesto = new Costruttore()
  return contesto
}

function suona() {
  const ctx = ottieniContesto()
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
}

/** L'interruttore e basta: lo usa il campanello in cima al menu. */
export function useCampanello() {
  const attivo = useSyncExternalStore(sottoscrivi, leggiPreferenza, preferenzaSulServer)
  return {
    attivo,
    alterna: useCallback(() => impostaPreferenza(!attivoCorrente), []),
  }
}

export function useAvvisoSonoro() {
  const attivo = useSyncExternalStore(sottoscrivi, leggiPreferenza, preferenzaSulServer)

  // L'AudioContext si può creare solo dopo un'interazione: si aggancia al
  // primo clic o tasto e poi si smette di ascoltare.
  useEffect(() => {
    function prepara() {
      ottieniContesto()
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

  return {
    attivo,
    cambia: useCallback((valore: boolean) => impostaPreferenza(valore), []),
    /** Suona solo se l'avviso sonoro è attivo su questo browser. */
    avvisa: useCallback(() => {
      if (attivo) suona()
    }, [attivo]),
    /** Suona a prescindere: serve al pulsante «prova». */
    provaSuono: useCallback(() => suona(), []),
  }
}
