-- La gestione semplice delle Young School e degli altri corsi.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-09-contatto-inserito-a-mano.sql.
--
-- Non cambia niente di strutturale, ed è di proposito: le colonne che servono
-- esistono già da 2026-09-02 (`gestito`, `gestito_da`, `gestito_il`, `note`).
-- Quello che cambia è **chi le scrive e cosa vogliono dire**, e uno schema che
-- non lo dice manda fuori strada chi legge la tabella dal SQL Editor.
--
-- Le richieste dal sito si lavorano in due modi diversi, perché sono due
-- lavori diversi (l'instradamento sta in lib/richieste.ts, il discrimine è
-- `inAgenda`):
--
--   1. **Abbonamento Club e Family** — passa dalla segreteria. La persona ha
--      una trattativa in `opportunita` con uno stato e un assegnatario, la
--      richiesta si chiude scegliendo un esito (`esito_tipo`) con una nota
--      obbligatoria (`esito`), e nello stesso gesto si programmano gli eventi
--      di seguito in `task`. Là `note` non si scrive più: la nota è una sola,
--      ed è quella della chiusura.
--
--   2. **Young School (tennis scuola, tennis competizione, nuoto, triathlon),
--      Summer Camp, Chinesis, corsi padel, Fitness Manager** — vanno dirette
--      al responsabile, che chiama e ha finito. Non c'è nessuna trattativa da
--      far avanzare né un secondo appuntamento da fissare in agenda: chiedere
--      un esito e un programmatore di eventi voleva dire far compilare un
--      modulo di vendita per dire «l'ho chiamata». Là restano due cose sole:
--      `gestito` (l'interruttore) e `note` (la nota, facoltativa e sempre
--      correggibile).
--
-- Su quelle righe `esito_tipo` ed `esito` non si scrivono più. Quelle già
-- scritte restano: sono lavorazioni vere fatte col pannello di prima, e
-- azzerarle vorrebbe dire cancellare il perché di richieste già chiuse.

comment on column public.form_contatti.gestito is
	'Se la richiesta è stata lavorata. Su Club e Family la scrive solo la chiusura con esito (vedi chiudiConEsito): là una richiesta lavorata è per definizione una richiesta chiusa con un esito. Sugli altri canali — Young School, Summer Camp, Chinesis, corsi padel, Fitness Manager — è l''interruttore della gestione semplice (vedi salvaGestione), e va nei due sensi: togliendolo la richiesta torna fra quelle da gestire.';

comment on column public.form_contatti.gestito_da is
	'Chi ha segnato la richiesta gestita, o chi l''ha chiusa con esito. Torna nullo quando il gestito viene tolto: lasciarlo scritto direbbe che la richiesta è stata gestita da qualcuno mentre l''elenco la rimette fra quelle da fare.';

comment on column public.form_contatti.gestito_il is
	'Quando la richiesta è stata segnata gestita o chiusa. Torna nullo insieme a gestito_da quando il gestito viene tolto.';

comment on column public.form_contatti.note is
	'La nota libera dell''operatore. Sui canali a gestione semplice (Young School, Summer Camp, Chinesis, corsi padel, Fitness Manager) è *la* nota: facoltativa, scrivibile prima o dopo il gestito, e sempre modificabile. Su Club e Family non si scrive più — là la nota è quella obbligatoria della chiusura, in `esito` — e le righe che ce l''hanno sono di prima di quella scelta: restano leggibili nei dettagli.';

-- Quante richieste per canale sono ancora da gestire, e quante hanno una
-- nota. Serve a rileggere l'effetto della semplificazione: se le note
-- restano a zero, il campo non serviva; se le richieste da gestire si
-- accumulano su un canale solo, il problema non è il pannello.
select
	coalesce(attivita, origine, '(non indicata)') as canale,
	settore,
	count(*) filter (where not gestito) as da_gestire,
	count(*) filter (where gestito) as gestite,
	count(*) filter (where note is not null) as con_nota
from public.form_contatti
group by 1, 2
order by 3 desc, 1;
