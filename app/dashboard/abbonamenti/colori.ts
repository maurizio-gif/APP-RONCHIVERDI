// Colori dei grafici a due categorie della pagina Abbonamenti. Un modulo a
// sé, senza 'use client': li usano sia page.tsx (grafico PASS, lato server)
// sia SezioniFiltrate.tsx (rinnovi e venduto, filtrati nel browser) — una
// costante importata da un file 'use client' non arriverebbe al server come
// valore.

// Rinnovati/non rinnovati sono uno stato (buono/da seguire), non
// un'identità di gruppo: colori di stato — gli stessi di badge-ok/badge-warn
// già usati nella tabella di dettaglio — non la palette categorica a 8
// colori usata per i gruppi prodotto negli altri due grafici qui sotto.
export const COLORE_RINNOVATO = 'var(--ok)'
export const COLORE_NON_RINNOVATO = 'var(--warn)'

// Nuovo/rinnovo (punto 5) non è un giudizio di merito come rinnovato/non
// rinnovato qui sopra — è solo una partizione del venduto in due categorie,
// nessuna "buona" o "da seguire" — quindi niente colori ok/warn: la stessa
// coppia neutra già usata altrove in pagina per due categorie senza
// giudizio (vedi .grafico-barra-sito/.grafico-barra-sede in globals.css).
export const COLORE_NUOVO = 'var(--accent)'
export const COLORE_RINNOVO = 'var(--info)'
