-- Ogni nota di lavorazione porta la firma di chi l'ha scritta.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-03-esiti.sql.
--
-- Il problema: la nota obbligatoria della chiusura (`esito`) c'era già, ma
-- non diceva di chi fosse. Su form_contatti si poteva risalire a `gestito_da`
-- — che però è la firma del *gestito*, non della nota, e chi corregge la nota
-- dopo la chiusura non è per forza chi ha chiuso. Su `task` non c'era
-- proprio niente: una voce d'agenda chiusa "fallita" con scritto «non ha
-- risposto» era anonima, e per sapere chi l'aveva scritta bisognava andare
-- nel registro operatori a cercare l'azione corrispondente per orario.
--
-- Da qui in avanti ogni nota ha accanto chi e quando, sulla riga stessa:
-- l'audit_log resta la storia, queste colonne sono lo stato attuale — quello
-- che si legge aprendo la voce, senza andare a cercarlo altrove.
--
-- Perché non riusare `completato_il` / `gestito_il`: quelli datano la
-- chiusura, e la nota si può correggere dopo (vedi correggiEsito in
-- app/dashboard/agenda/esito-actions.ts). Tenerli insieme vorrebbe dire o
-- perdere quando è stata chiusa, o dire il falso su quando è stata scritta la
-- nota che si sta leggendo.

-- ─────────────────────────────────────────────────────────────────── task

alter table public.task
	add column if not exists esito_da text;

alter table public.task
	add column if not exists esito_il timestamptz;

comment on column public.task.esito_da is
	'Email di chi ha scritto l''esito e la sua nota. Si aggiorna anche quando la nota viene corretta dopo la chiusura: è la firma della nota che si sta leggendo, non di chi chiuse per primo.';

comment on column public.task.esito_il is
	'Quando l''esito è stato scritto o corretto l''ultima volta. Distinto da completato_il, che data la chiusura e non cambia più.';

-- ──────────────────────────────────────────────────────────── form_contatti

alter table public.form_contatti
	add column if not exists esito_da text;

alter table public.form_contatti
	add column if not exists esito_il timestamptz;

comment on column public.form_contatti.esito_da is
	'Email di chi ha scritto la nota di chiusura. Distinta da gestito_da, che firma il gestito: correggendo la nota cambia questa, non quella.';

comment on column public.form_contatti.esito_il is
	'Quando la nota di chiusura è stata scritta o corretta l''ultima volta.';

-- La nota della gestione semplice (Young School, Summer Camp, Chinesis,
-- padel, Fitness Manager) sta in `note` e non in `esito`: là non c'è una
-- trattativa e la chiusura è l'interruttore «gestito». Adesso che anche
-- quella nota è obbligatoria, vuole la stessa firma — ed è una firma sua,
-- perché la nota si può correggere senza toccare il gestito.
alter table public.form_contatti
	add column if not exists note_da text;

alter table public.form_contatti
	add column if not exists note_il timestamptz;

comment on column public.form_contatti.note_da is
	'Email di chi ha scritto l''ultima versione della nota di gestione (`note`). Distinta da gestito_da: la nota si corregge senza riaprire la richiesta.';

comment on column public.form_contatti.note_il is
	'Quando la nota di gestione è stata scritta o corretta l''ultima volta.';

-- ─────────────────────────────────────────── le righe già chiuse, firmate
--
-- Le chiusure fatte prima di oggi hanno una nota e nessuna firma. Dove la
-- firma si può dedurre senza inventarla la scriviamo, così l'elenco non si
-- divide in "prima" e "dopo": su form_contatti chi ha chiuso con un esito è
-- per forza chi ha segnato il gestito nello stesso gesto (vedi
-- chiudiConEsito), e quella è la firma giusta.
--
-- Su `task` non c'è niente da dedurre: quelle note restano senza firma, e
-- l'interfaccia lo dice — meglio «firma non registrata» che attribuire a
-- qualcuno una nota che potrebbe non aver scritto.

update public.form_contatti
set esito_da = gestito_da,
    esito_il = gestito_il
where esito is not null
  and esito_da is null
  and gestito_da is not null;
