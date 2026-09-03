-- Esiti di lavorazione: chiudere una voce di agenda o una richiesta dal sito
-- dicendo *com'è andata*, non solo che è stata chiusa.
--
-- Perché una colonna nuova invece di allargare `stato`: `stato` è il ciclo di
-- vita (aperto → chiuso, oppure annullato) e serve alle query che cercano il
-- lavoro ancora da fare, incluso l'indice parziale su stato = 'aperto'.
-- L'esito è un giudizio su una voce già chiusa: sono due assi diversi, e
-- mescolarli avrebbe costretto ogni filtro "cosa resta da fare" a elencare
-- tutti i modi in cui una cosa può essere finita.
--
-- Nullo = voce ancora aperta, oppure chiusa prima che gli esiti esistessero:
-- non si riscrive il passato attribuendogli un esito che nessuno ha scelto.

-- ─────────────────────────────────────────────────────────────────── task

alter table public.task
	add column if not exists esito_tipo text;

alter table public.task
	drop constraint if exists task_esito_tipo_check;

alter table public.task
	add constraint task_esito_tipo_check
	check (esito_tipo is null or esito_tipo in ('eseguita', 'fallita'));

comment on column public.task.esito_tipo is
	'Com''è andata, su una voce chiusa: eseguita | fallita. Nullo se ancora aperta.';

comment on column public.task.esito is
	'La nota obbligatoria scritta chiudendo la voce: cosa è stato detto o perché è fallita.';

-- ──────────────────────────────────────────────────────────── form_contatti

alter table public.form_contatti
	add column if not exists esito_tipo text;

alter table public.form_contatti
	drop constraint if exists form_contatti_esito_tipo_check;

alter table public.form_contatti
	add constraint form_contatti_esito_tipo_check
	check (esito_tipo is null or esito_tipo in ('eseguita', 'fallita'));

-- La nota dell'esito sta in una colonna sua: `note` è il promemoria che
-- l'operatore aggiorna mentre lavora la richiesta, e sovrascriverlo con la
-- nota di chiusura cancellerebbe quello che si era annotato prima.
alter table public.form_contatti
	add column if not exists esito text;

comment on column public.form_contatti.esito_tipo is
	'Com''è andata la lavorazione: eseguita | fallita. Nullo se ancora da lavorare.';

comment on column public.form_contatti.esito is
	'La nota obbligatoria scritta chiudendo la richiesta. Distinta da `note`, che è il promemoria libero.';

-- Le richieste chiuse si filtrano per esito nelle statistiche: senza indice
-- ogni conteggio per esito farebbe una scansione completa.
create index if not exists form_contatti_esito_tipo_idx
	on public.form_contatti (esito_tipo)
	where esito_tipo is not null;

create index if not exists task_esito_tipo_idx
	on public.task (esito_tipo)
	where esito_tipo is not null;
