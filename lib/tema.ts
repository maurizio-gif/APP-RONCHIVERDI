// Il tema chiaro o scuro, ricordato nel browser.
//
// Nel browser e non nel database, come l'interruttore delle push: è una
// preferenza del **dispositivo**, non della persona. Il telefono con cui si
// timbra il cartellino la sera vuole lo scuro, il portatile in reception di
// giorno vuole il chiaro, e sono lo stesso account.
//
// È lo stesso meccanismo del pannello Athlon (lib/tema.ts di APP-ATHLON): la
// chiave cambia — due app sullo stesso browser non devono scambiarsi la
// preferenza — il resto no, e se un giorno si sistema una di queste due
// implementazioni va sistemata anche l'altra.

export type Tema = 'chiaro' | 'scuro'

export const CHIAVE_TEMA = 'ronchiverdi-tema'

// Lo script che gira prima del primo disegno, incollato nel <head>.
//
// Deve stare lì e non in un componente React: qualunque cosa passi da React
// gira **dopo** il primo disegno, e per un istante si vedrebbe la pagina
// chiara prima che diventi scura. Su un pannello che si apre venti volte al
// giorno quel lampo crema è la cosa che si nota di più.
//
// Il chiaro è il predefinito e non `prefers-color-scheme`: è una scelta, non
// una dimenticanza. Chi vuole lo scuro lo accende, e da quel momento è suo su
// quel dispositivo; legare il tema all'impostazione di sistema vorrebbe dire
// che il pannello cambia aspetto da solo al tramonto su un Mac configurato in
// automatico.
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  CHIAVE_TEMA
)});if(t==='scuro')document.documentElement.setAttribute('data-tema','scuro')}catch(e){}})()`

export function temaSalvato(): Tema {
  if (typeof window === 'undefined') return 'chiaro'
  try {
    return window.localStorage.getItem(CHIAVE_TEMA) === 'scuro' ? 'scuro' : 'chiaro'
  } catch {
    return 'chiaro'
  }
}

export function applicaTema(tema: Tema) {
  if (typeof document === 'undefined') return
  if (tema === 'scuro') document.documentElement.setAttribute('data-tema', 'scuro')
  else document.documentElement.removeAttribute('data-tema')
  try {
    window.localStorage.setItem(CHIAVE_TEMA, tema)
  } catch {
    // Navigazione privata o storage pieno: il tema vale per questa sessione e
    // basta, che è meglio di un errore in faccia.
  }
}
