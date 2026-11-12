-- Manutenzione dentro le segnalazioni.
--
-- Un solo punto d'ingresso: la segnalazione. Quando la tipologia è
-- «manutenzione» non viene da un socio ma da un operatore interno, non ha
-- socio né richiamo, e la gestisce la manutenzione: il responsabile inserisce
-- la data prevista dell'intervento e chi lo esegue lo segna fatto. In elenco
-- ogni richiesta ha un colore: rosso da fare (senza data), giallo programmato
-- (con data), verde fatto.
--
-- La colonna `urgenza` resta com'è (rinominarla romperebbe il codice già in
-- produzione): nel CRM si chiama «Tipologia» e ora ha anche il valore
-- «manutenzione». Le altre tre (sicurezza, disservizio, comfort) restano le
-- tipologie delle lamentele dei soci.
--
-- Solo aggiunte: un valore nelle liste ammesse, una colonna facoltativa, una
-- tabella di impostazioni, qualche motivo in più.

alter table public.segnalazioni drop constraint if exists segnalazioni_urgenza_check;
alter table public.segnalazioni add constraint segnalazioni_urgenza_check
	check (urgenza in ('sicurezza', 'disservizio', 'comfort', 'manutenzione'));

alter table public.segnalazioni drop constraint if exists segnalazioni_canale_check;
alter table public.segnalazioni add constraint segnalazioni_canale_check
	check (canale in ('reception', 'telefono', 'email', 'altro', 'interno'));

alter table public.segnalazioni_eventi drop constraint if exists segnalazioni_eventi_tipo_check;
alter table public.segnalazioni_eventi add constraint segnalazioni_eventi_tipo_check check (tipo in (
	'ricezione', 'assegnazione', 'nota', 'presa_in_carico', 'risoluzione', 'richiamo', 'riapertura', 'archiviazione',
	'programmazione'
));

-- Il giorno in cui l'intervento è previsto, scritto dal responsabile della
-- manutenzione. Senza data una richiesta è «da fare»; con la data è
-- «programmata»; quando si segna fatta resta la data prevista accanto a
-- quella di chiusura (risolta_il), per vedere se si è rispettata.
alter table public.segnalazioni add column if not exists intervento_previsto_il date;

create index if not exists segnalazioni_manutenzione_idx
	on public.segnalazioni (stato, intervento_previsto_il) where urgenza = 'manutenzione';

-- Impostazioni del modulo, modificabili qui senza toccare il codice.
--   responsabile_manutenzione   email di chi riceve le nuove richieste di
--                               manutenzione (se vuota, nessuna email: le
--                               richieste si vedono comunque in Manutenzione)
create table if not exists public.segnalazioni_impostazioni (
	chiave text primary key,
	valore text
);

alter table public.segnalazioni_impostazioni enable row level security;
revoke all on public.segnalazioni_impostazioni from anon, authenticated;

insert into public.segnalazioni_impostazioni (chiave, valore) values ('responsabile_manutenzione', null)
on conflict (chiave) do nothing;

-- Qualche motivo in più, per le richieste di manutenzione.
insert into public.segnalazioni_motivi (chiave, nome, ordine) values
	('impianto-elettrico', 'Impianto elettrico', 280),
	('impianto-idraulico', 'Impianto idraulico o perdite', 290),
	('edile-esterni', 'Muri, pavimenti, infissi, esterni', 300)
on conflict (chiave) do nothing;

-- Il permesso della vista Manutenzione: parte da chi gestisce i ticket; il
-- responsabile e i manutentori si abilitano da Gestione utenti.
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'manutenzione')
where email in (select email from public.ticket_gestori)
	and not ('manutenzione' = any (sezioni_consentite));

-- Il livello di urgenza da 1 a 5, attribuito da chi registra (come nell'Excel
-- storico: 1 trascurabile, 5 massima). È un'altra cosa dalla tipologia: dice
-- quanto pesa questa segnalazione, non di che genere è. Le righe già
-- registrate prima di questa colonna valgono 3.
alter table public.segnalazioni
	add column if not exists livello_urgenza smallint not null default 3
	check (livello_urgenza between 1 and 5);
