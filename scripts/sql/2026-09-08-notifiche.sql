-- Messaggi interni del pannello: una comunicazione da un operatore a uno o
-- più colleghi, con conferma di lettura, allegato facoltativo e — se il
-- destinatario le ha attivate su quel dispositivo — una notifica push del
-- sistema operativo.
--
-- Perché non basta il gruppo WhatsApp che la segreteria usa già: qui il
-- messaggio resta legato al pannello, e soprattutto resta la conferma di
-- lettura con data e ora. "Gliel'ho detto" e "l'ha letto alle 9:14" sono due
-- cose diverse, e la seconda è l'unica che serve quando una comunicazione di
-- servizio non è stata eseguita.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-02-staff-e-audit.sql.
--
--   notifiche          → i messaggi, una riga per destinatario
--   push_subscriptions → i dispositivi su cui ricevere le push
--   bucket notifiche-allegati → i file allegati, privati


-- ---------------------------------------------------------------------------
-- notifiche — una riga per destinatario, non per messaggio
-- ---------------------------------------------------------------------------
-- Un messaggio a tre persone sono tre righe con lo stesso batch_id. È la
-- scelta che regge tutto il resto: la conferma di lettura è di ciascuno, e con
-- una riga sola per messaggio servirebbe una tabella di appoggio per dire chi
-- l'ha letto — cioè la stessa cosa scritta in due tabelle.
--
-- batch_id resta null quando il destinatario è uno solo: così "inviato anche
-- a" compare solo quando c'è davvero qualcun altro.
create table if not exists public.notifiche (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),

	-- Le email e non un id: sono la chiave di staff_users, e restano
	-- leggibili nell'elenco anche senza una join in più.
	da_email text not null references public.staff_users (email) on delete cascade,
	a_email text not null references public.staff_users (email) on delete cascade,

	messaggio text not null,

	-- Il momento in cui il destinatario ha premuto "Confermo di aver letto".
	-- Non è "visualizzato": è una dichiarazione, ed è quello che serve.
	letta_il timestamptz,

	batch_id uuid,

	-- L'allegato vive nello Storage: qui restano nome, tipo e peso, cioè
	-- quello che serve per disegnare la riga senza scaricare il file.
	allegato_path text,
	allegato_nome text,
	allegato_tipo text,
	allegato_dimensione integer
);

comment on table public.notifiche is
	'Messaggi interni fra operatori del pannello. Una riga per destinatario: la conferma di lettura è di ciascuno. Le righe con lo stesso batch_id sono lo stesso messaggio mandato a più persone.';
comment on column public.notifiche.letta_il is
	'Quando il destinatario ha confermato di aver letto. Null = non ancora confermato: è quello che alimenta il badge nel menu e l''avviso bloccante.';
comment on column public.notifiche.batch_id is
	'Uguale su tutte le righe di uno stesso invio multiplo, null se il destinatario era uno solo.';
comment on column public.notifiche.allegato_path is
	'Percorso nel bucket privato notifiche-allegati. Il file si serve con URL firmate di pochi minuti, generate lato server.';

-- L'indice che conta è quello del badge — «quante non lette ha questa
-- persona» — interrogato a ogni giro di polling di ogni pannello aperto.
create index if not exists notifiche_destinatario_idx on public.notifiche (a_email, created_at desc);
create index if not exists notifiche_non_lette_idx on public.notifiche (a_email) where letta_il is null;
create index if not exists notifiche_mittente_idx on public.notifiche (da_email, created_at desc);
create index if not exists notifiche_batch_idx on public.notifiche (batch_id) where batch_id is not null;


-- ---------------------------------------------------------------------------
-- push_subscriptions — un dispositivo, non una persona
-- ---------------------------------------------------------------------------
-- La stessa persona attiva le notifiche sul telefono e sul computer e le
-- riceve su entrambi: la chiave è l'endpoint, che il browser genera per ogni
-- installazione. Legarle alla sola email vorrebbe dire che attivare il
-- secondo dispositivo spegne il primo.
create table if not exists public.push_subscriptions (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	email text not null references public.staff_users (email) on delete cascade,
	endpoint text not null unique,
	p256dh text not null,
	auth text not null
);

comment on table public.push_subscriptions is
	'Dispositivi su cui un operatore ha attivato le notifiche push. Una riga per dispositivo (endpoint univoco), non per persona. La riga si cancella da sola quando il servizio push risponde 404/410: quel dispositivo non c''è più.';

create index if not exists push_subscriptions_email_idx on public.push_subscriptions (email);


-- ---------------------------------------------------------------------------
-- Lo Storage degli allegati
-- ---------------------------------------------------------------------------
-- Bucket privato, come candidature-cv: gli allegati si servono con URL
-- firmate di cinque minuti, generate lato server a ogni caricamento della
-- pagina. Pubblico significherebbe un documento interno raggiungibile da
-- chiunque indovini il percorso.
insert into storage.buckets (id, name, public)
values ('notifiche-allegati', 'notifiche-allegati', false)
on conflict (id) do nothing;


-- RLS attiva e nessuna policy: si entra solo con la service role key dalle
-- Server Action del pannello, come per le altre tabelle amministrative. Un
-- client col solo anon key non vede niente.
alter table public.notifiche enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.notifiche from anon, authenticated;
revoke all on public.push_subscriptions from anon, authenticated;
