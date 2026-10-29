// L'avvio animato del CRM: la pallina da tennis del logo gira su se stessa e,
// girando, compone il logo; poi arriva la scritta. Una volta a ogni apertura.
//
// Nato dall'avvio del pannello Athlon (src/features/lab/avvio di
// PORTALE-ATHLON), con le stesse regole di fondo, adattate al browser:
//   - **ogni movimento è una funzione pura del tempo** `t` (ms dall'inizio):
//     un solo orologio (requestAnimationFrame) scrive `t` e il fotogramma si
//     disegna da lì, senza stato nascosto (vedi lib/avvio-disegno.ts);
//   - **una volta per apertura**: per scheda del browser (sessionStorage),
//     quindi ricaricare non lo rifà, riaprire il CRM dopo averlo chiuso sì;
//   - **un tocco, un clic o un tasto lo salta** (via in un terzo di secondo);
//   - **«riduci movimento»**: niente si muove, il logo finito entra ed esce
//     in dissolvenza;
//   - **il fondo scuro prima del codice**: senza, per un istante si vedrebbe
//     la pagina prima che l'avvio parta (vedi SCRIPT_AVVIO).
// A differenza di Athlon qui c'è anche la scritta: il logo del Club è la
// pallina e il nome insieme, e il nome si scrive dopo che la pallina si è
// fermata.

export const CHIAVE_AVVIO = 'ronchiverdi-avvio-mostrato'

/** Il nero caldo dell'avvio: lo stesso della sidebar e dell'icona del CRM. */
export const FONDO_AVVIO = '#14130f'

// ───────────────────────────────────────────────────────────────── tempi

/** Le tappe dell'avvio, in millisecondi dall'inizio. */
export const TAPPE = {
  /** Il fondo e l'alone entrano; la pallina appare, liscia, e comincia a girare. */
  entrata: 0,
  giraDa: 200,
  giraA: 2150,
  /** La cucitura si disegna sulla pallina, mentre gira. */
  cuciturDa: 450,
  cuciturA: 1750,
  /** La pallina si ferma sul logo: scende da grande al suo posto. */
  assestaDa: 1650,
  assestaA: 2300,
  /** Lo scatto: la pallina è ferma sul logo, parte l'anello. */
  scatto: 2150,
  riflessoDa: 2250,
  riflessoA: 2950,
  scrittaDa: 2250,
  scrittaA: 3150,
  sportClubDa: 2950,
  sportClubA: 3450,
  uscitaDa: 3500,
  fine: 3900,
} as const

export const DURATA_MS = TAPPE.fine
/** Quanto ci mette a sparire quando lo si salta. */
export const SALTO_MS = 320
/** Con «riduci movimento»: il logo finito, in dissolvenza. */
export const DURATA_RIDOTTA_MS = 1500
/** Giri completi che la pallina fa su se stessa prima di fermarsi sul logo. */
export const GIRI = 2

// ───────────────────────────────────────────────── funzioni del tempo

export const limita = (x: number, minimo = 0, massimo = 1) => Math.min(massimo, Math.max(minimo, x))

/** Quanto è avanzato un movimento che parte a `inizio` e dura `durata`: da 0 a 1. */
export const fase = (t: number, inizio: number, durata: number) => limita((t - inizio) / durata)

/** Parte veloce e rallenta (ease-out cubico). */
export const rallenta = (x: number) => 1 - Math.pow(1 - x, 3)

/** Più netto di `rallenta`: per le cose che «scattano». */
export const scatta = (x: number) => 1 - Math.pow(1 - x, 5)

/** Parte piano, accelera e rallenta (ease-in-out cubico). */
export const dolce = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** Un picco attorno a `centro`, largo `larghezza` ms: da 0 a 1 e di nuovo a 0. */
export const impulso = (t: number, centro: number, larghezza: number) => Math.exp(-Math.pow((t - centro) / larghezza, 2))

/**
 * L'angolo di rotazione della pallina all'istante `t`, in radianti: da 0 a
 * GIRI giri completi, veloce all'inizio e sempre più lenta, e arriva a un
 * multiplo esatto di un giro — cioè **di fronte**, con la cucitura nella
 * posizione del logo — nell'istante in cui si ferma.
 */
export function angoloPallina(t: number): number {
  const x = fase(t, TAPPE.giraDa, TAPPE.giraA - TAPPE.giraDa)
  return GIRI * 2 * Math.PI * (1 - Math.pow(1 - x, 2.6))
}

/** Quanto della cucitura è già disegnato (0-1), lungo il suo percorso. */
export function cucituraDisegnata(t: number): number {
  return dolce(fase(t, TAPPE.cuciturDa, TAPPE.cuciturA - TAPPE.cuciturDa))
}

/** Quanto la scena sta uscendo (0 = tutta, 1 = sparita), con un salto a `salto` ms se c'è. */
export function uscita(t: number, salto: number | null): number {
  if (salto !== null) return fase(t, salto, SALTO_MS)
  return fase(t, TAPPE.uscitaDa, TAPPE.fine - TAPPE.uscitaDa)
}

// ───────────────────────────────────────────── quando si vede l'avvio

/**
 * Le pagine in cui l'avvio non si fa: i collegamenti che arrivano da una
 * email (invito, recupero password, conferma) e le rotte tecniche. Chi ha
 * cliccato un link per impostare la password ha un lavoro da finire, non una
 * scena da guardare.
 */
export const PERCORSI_SENZA_AVVIO = ['/imposta-password', '/recupera-password', '/auth', '/api']

export function percorsoConAvvio(percorso: string): boolean {
  return !PERCORSI_SENZA_AVVIO.some((p) => percorso === p || percorso.startsWith(`${p}/`))
}

/**
 * Lo script che decide **e segna** se l'avvio si fa, incollato nel <head> e
 * eseguito prima del primo disegno. Se sì, mette `data-avvio="1"` su <html>:
 * da quel momento un velo scuro (vedi globals.css) copre la pagina finché
 * l'avvio non parte e poi finisce. Deve stare qui e non in un componente
 * React, che girerebbe dopo il primo disegno: per un istante si vedrebbe la
 * pagina, poi il velo. Decidere e segnare sono un'operazione sola, così un
 * ricaricamento a metà non lo rifà.
 *
 * Una rete di sicurezza toglie il velo dopo sette secondi in ogni caso:
 * qualunque cosa succeda, l'app non resta nascosta.
 */
export const SCRIPT_AVVIO = `(function(){try{var p=location.pathname;var no=${JSON.stringify(
  PERCORSI_SENZA_AVVIO
)};for(var i=0;i<no.length;i++){if(p===no[i]||p.indexOf(no[i]+'/')===0)return}var k=${JSON.stringify(
  CHIAVE_AVVIO
)};try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1')}catch(e){}var h=document.documentElement;h.setAttribute('data-avvio','1');setTimeout(function(){h.removeAttribute('data-avvio')},7000)}catch(e){}})()`
