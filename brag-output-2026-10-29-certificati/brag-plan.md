# Piano: Certificati medici — guida per la segreteria

> **Deroga alla regola «15–25 secondi».** Come per la guida dell'Agenda, qui è una guida interna da far vedere a tutto
> lo staff: ~3 min, in capitoli. Restano valide le altre leggi (leggibile, specifico, mostra la cosa vera).
> **Voce narrante: spenta** (non richiesta): testi grandi in italiano e musica.

## Che cos'è
CRM Ronchiverdi, sezione **Segreteria → Voucher visita medica**: dal 2026 gli abbonamenti con la sigla «(cer000)»
fanno partire in automatico il voucher per la visita medico-sportiva (partner Chiron).

## Angolo
Un solo socio fittizio (Mario Rossi) seguito dalla vendita al certificato in Info4U. Tono `polished`, da collega che
mostra lo schermo. Niente slogan; la sola frase «d'autore» è il finale: «Un codice. Dodici mesi. Una casella.»

## Hook
Scheda scura col logo: «Certificati medici» / «Il nuovo processo con Chiron».

## Scene
1. Titolo — 7 s
2. Il processo: cinque passi, quali a mano e quali automatici — 12 s
3. **Alla vendita**: sigla «(cer000)» nel nome prodotto — 14.6 s
4. **Il socio riceve il codice**: email col voucher (testi da `voucher-email-testi.ts`), 8 cifre, 12 mesi, online (campo Note) o telefono — 16 s
5. **Cosa vedi nel CRM**: elenco voucher, stati, esiti email, «Reinvia email»; il codice non si vede — 20 s
5b. **Socio senza email**: «Manca email» in evidenza, campo e «Salva e invia»; oppure email aggiunta in Info4U entro 7 giorni — 22 s
6. **Chiron usa il codice**: Validazione voucher, verifica, conferma, codice consumato — 22 s
7. **Notifica e stato «Utilizzato»**: email al socio, riga in CRM — 15 s
8. **Il certificato**: casella `certificatimedici@ronchiverdi.it`, allegato via email, cartaceo fotografato in reception — 18 s
9. **Poi la segreteria**: controlla, inserisce la data in Info4U a mano, l'email resta in casella — 15 s
10. Da ricordare + finale — 17 s

## Grounding (ogni affermazione dal codice)
- «(cer000)», 15 minuti, 7 giorni: `app/dashboard/voucher/page.tsx`
- 12 mesi, 8 cifre, monouso: `lib/voucher.ts`
- testi delle email, casella certificati: `supabase/functions/_shared/voucher-email-testi.ts`
- validazione e notifica di utilizzo: `app/dashboard/validazione/Validatore.tsx`
- Dati, nomi, email e codici nel video sono **fittizi**.

## Audio
Due tracce bundled (Ende — Happy Beats Business Moves vol. 12 e vol. 9), normalizzate a −21 LUFS, dissolvenza
incrociata a inizio capitolo «Chiron». SFX discreti su ingressi e click. Audio-reattività e beat-lock: non applicati
(priorità alla leggibilità dei testi di interfaccia).
