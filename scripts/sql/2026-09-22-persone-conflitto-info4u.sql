-- Le anagrafiche nate da un modulo del sito o dal Guest Register (fonte
-- 'form_contatti') o inserite a mano non vanno mai riscritte dalla
-- sincronizzazione Info4U: nome, cognome, email e cellulare sono i dati che
-- la persona stessa ha dato, non un campo da "correggere" con quello che
-- dice un altro sistema. Prima di questa migration, quando un utente
-- Info4U condivideva email o cellulare con un contatto già in anagrafica
-- (coincidenza tutt'altro che rara: indirizzo di famiglia, numero fisso
-- condiviso), ops/sync-info4u/sync-abbonamenti.ps1 sovrascriveva quella
-- riga con i dati di Info4U — perdendo silenziosamente l'anagrafica
-- originale e, con lei, l'identità di ogni trattativa collegata.
--
-- Da qui in avanti: se l'email o il cellulare di un utente Info4U
-- risultano già di una persona con un'altra fonte, quella persona non
-- viene toccata. Lo script crea invece una riga separata per l'utente
-- Info4U (senza il campo in conflitto, per non violare l'indice univoco né
-- dichiarare un'identità che non è verificata), con un puntatore a quale
-- persona possiede già quel recapito — cosicché la scheda di entrambe
-- possa segnalarlo con un link, e sia uno staff a decidere se unirle.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-17-sync-info4u-abbonamenti.sql.

alter table public.persone
	add column if not exists conflitto_con_persona_id uuid references public.persone (id) on delete set null,
	add column if not exists conflitto_campo text check (conflitto_campo in ('email', 'cellulare'));

comment on column public.persone.conflitto_con_persona_id is
	'Valorizzato solo sulle righe create da sync-abbonamenti.ps1 quando l''email o il cellulare dell''utente Info4U risultavano già di un''altra persona (fonte diversa da info4u): punta a quella persona, che NON viene mai toccata. Per risolvere manualmente il conflitto (confermato lo stesso contatto o due persone distinte), uno staff pulisce questa colonna e conflitto_campo dopo aver sistemato l''anagrafica a mano — il prossimo giro di sincronizzazione non ritenta da solo.';
comment on column public.persone.conflitto_campo is
	'Quale campo ha causato il conflitto (''email'' o ''cellulare''): è anche il campo che su questa riga è stato lasciato vuoto invece di essere scritto, per non collidere con l''indice univoco della persona già esistente.';

create index if not exists persone_conflitto_con_idx
	on public.persone (conflitto_con_persona_id)
	where conflitto_con_persona_id is not null;
