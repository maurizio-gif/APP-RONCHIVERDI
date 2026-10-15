-- «Richiamami» con fascia oraria, al posto del messaggio nel modulo Club e
-- Family del sito.
--
-- Fino a ottobre 2026 il modulo offriva «Appuntamento in sede» (il tour, con
-- giorno e ora) o «Messaggio» (un testo libero, a cui si rispondeva per
-- email). Il messaggio diventa «Richiamami»: la persona sceglie in che fascia
-- preferisce essere chiamata — tutti i giorni — e scrive cosa le serve. Il
-- giorno no: chi richiama non è legato a una data, ma se la persona ha detto
-- «di sera» la si chiama di sera.
--
-- La richiesta arriva con azione = 'richiamami' e la fascia qui. Nel CRM è una
-- Telefonata da fare senza giorno né ora (come un messaggio, si colloca nel
-- giorno in cui è arrivata e resta da fare finché non la si chiude), con la
-- fascia al posto dell'ora: vedi FASCE_RICHIAMO in lib/agenda.ts.
--
-- Le chiavi sono le stesse del sito (src/lib/leadForm.client.js): mattina
-- 9–13, pomeriggio 13–17, sera 17–20. Solo additiva: le righe esistenti
-- restano con fascia nulla.

alter table public.form_contatti
	add column if not exists fascia_oraria text;

alter table public.form_contatti
	drop constraint if exists form_contatti_fascia_oraria_check;
alter table public.form_contatti
	add constraint form_contatti_fascia_oraria_check
	check (fascia_oraria is null or fascia_oraria in ('mattina', 'pomeriggio', 'sera'));

comment on column public.form_contatti.fascia_oraria is
	'«Richiamami» dal sito: la fascia in cui la persona preferisce essere chiamata (mattina 9–13, pomeriggio 13–17, sera 17–20). Null per le altre richieste.';
