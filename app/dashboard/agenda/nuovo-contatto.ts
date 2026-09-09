// Il testo scritto nella ricerca dei contatti, riletto come i campi di un
// contatto nuovo.
//
// Serve a una cosa sola: chi cerca «Mario Rossi» o un numero, non lo trova e
// passa a «Nuovo contatto» non deve riscrivere quello che ha appena scritto.
// Sta in un file suo perché è una regoletta con dei casi, e dentro il
// componente sarebbe stata una funzione anonima da rileggere ogni volta.

/** I campi che si riesce a indovinare dal testo cercato. */
export type CampiIndovinati = {
  nome?: string
  cognome?: string
  email?: string
  cellulare?: string
}

/**
 * Divide il testo cercato nei campi di un contatto nuovo.
 *
 *  - con una chiocciola è un'email, e niente altro: un indirizzo spezzato in
 *    nome e cognome sarebbe da cancellare a mano;
 *  - se sono quasi tutte cifre è un telefono — spazi, punti, barre e il
 *    prefisso internazionale compresi, che è come si scrivono i numeri;
 *  - altrimenti è un nome: la prima parola al nome, il resto al cognome.
 *    «Maria Teresa Del Bono» finisce in «Maria» + «Teresa Del Bono», che è
 *    sbagliato ma visibile e si corregge in due tasti — mentre indovinare i
 *    cognomi composti no.
 *
 * Ritorna solo i campi che ha riconosciuto: quelli assenti restano come sono,
 * vuoti o già scritti.
 */
export function dividiTestoContatto(testo: string): CampiIndovinati {
  const pulito = (testo ?? '').trim()
  if (!pulito) return {}

  if (pulito.includes('@')) return { email: pulito.toLowerCase() }

  const cifre = pulito.replace(/[^0-9]/g, '')
  if (cifre.length >= 6 && /^[0-9+\s.\-/()]+$/.test(pulito)) return { cellulare: pulito }

  const parole = pulito.split(/\s+/)
  return parole.length === 1
    ? { nome: parole[0] }
    : { nome: parole[0], cognome: parole.slice(1).join(' ') }
}
