-- Segnalazioni dei soci: lamentele e disservizi raccolti dal banco.
--
-- Sostituisce il file Excel «Report lamentele e segnalazioni» (fogli
-- 2024-2025 e 2026): una riga per segnalazione, con numero, settore e motivo
-- da elenchi chiusi, chi l'ha raccolta, a chi tocca, quando è stata presa in
-- carico e risolta. Dal numero si risale alla storia di ogni passaggio.
--
--   segnalazioni_settori   gli ambienti del club, ciascuno col suo responsabile
--                          (modificabile qui, senza toccare il codice)
--   segnalazioni_motivi    cosa è andato storto: l'elenco chiuso dei motivi
--   segnalazioni           una riga per segnalazione
--   segnalazioni_eventi    la storia: ricezione, assegnazioni, note, presa in
--                          carico, risoluzione, richiamo del socio
--
-- Stati: ricevuta → in_carico → (da_richiamare) → risolta; archiviata per
-- quelle non pertinenti o doppie. «da_richiamare» è il problema sistemato per
-- il quale il socio ha chiesto di essere ricontattato: finché la customer care
-- non lo richiama e registra l'esito, la segnalazione non è chiusa.
--
-- Le scadenze si scrivono sulla riga alla ricezione (le calcola il codice da
-- urgenza, vedi lib/segnalazioni.ts): cambiare i tempi in futuro non riscrive
-- la storia delle segnalazioni già registrate.
--
-- Elenchi di partenza presi dal «Foglio8» dell'Excel, con le varianti scritte
-- a mano ricondotte a una sola voce. DA CONFERMARE con Lorella.
--
-- Tutto con RLS accesa e nessuna policy: legge e scrive solo il server.

create table if not exists public.segnalazioni_settori (
	chiave text primary key,
	nome text not null,
	-- Chi riceve le segnalazioni di questo settore. Null = nessuno ancora:
	-- le segnalazioni restano «da assegnare» finché qualcuno le prende.
	responsabile_email text,
	ordine smallint not null default 100,
	attivo boolean not null default true
);

create table if not exists public.segnalazioni_motivi (
	chiave text primary key,
	nome text not null,
	ordine smallint not null default 100,
	attivo boolean not null default true
);

create table if not exists public.segnalazioni (
	id uuid primary key default gen_random_uuid(),
	-- Il numero da dire a voce: «la segnalazione 42».
	numero integer generated always as identity unique,
	ricevuta_il timestamptz not null default now(),
	raccolta_da text not null,
	canale text not null default 'reception',
	settore text not null references public.segnalazioni_settori(chiave),
	motivo text not null references public.segnalazioni_motivi(chiave),
	descrizione text not null,
	-- Come lo scrive chi raccoglie: spesso solo il cognome, a volte «le socie
	-- della lezione». Il collegamento all'anagrafica verrà dopo.
	socio_nome text,
	richiamo_richiesto boolean not null default false,
	urgenza text not null default 'disservizio',
	stato text not null default 'ricevuta',
	assegnato_a text,
	presa_in_carico_il timestamptz,
	risolta_il timestamptz,
	richiamato_il timestamptz,
	scadenza_presa_il timestamptz not null,
	scadenza_risoluzione_il timestamptz not null,
	aggiornato_il timestamptz not null default now(),
	constraint segnalazioni_canale_check check (canale in ('reception', 'telefono', 'email', 'altro')),
	constraint segnalazioni_urgenza_check check (urgenza in ('sicurezza', 'disservizio', 'comfort')),
	constraint segnalazioni_stato_check check (
		stato in ('ricevuta', 'in_carico', 'da_richiamare', 'risolta', 'archiviata')
	)
);

create index if not exists segnalazioni_ricevuta_idx on public.segnalazioni (ricevuta_il desc);
create index if not exists segnalazioni_stato_idx on public.segnalazioni (stato, ricevuta_il desc);
create index if not exists segnalazioni_settore_idx on public.segnalazioni (settore, ricevuta_il desc);
create index if not exists segnalazioni_assegnato_idx on public.segnalazioni (assegnato_a, stato);

create table if not exists public.segnalazioni_eventi (
	id uuid primary key default gen_random_uuid(),
	segnalazione_id uuid not null references public.segnalazioni(id) on delete cascade,
	creato_il timestamptz not null default now(),
	autore text not null,
	tipo text not null,
	testo text,
	constraint segnalazioni_eventi_tipo_check check (tipo in (
		'ricezione', 'assegnazione', 'nota', 'presa_in_carico', 'risoluzione', 'richiamo', 'riapertura', 'archiviazione'
	))
);

create index if not exists segnalazioni_eventi_idx on public.segnalazioni_eventi (segnalazione_id, creato_il);

alter table public.segnalazioni_settori enable row level security;
alter table public.segnalazioni_motivi enable row level security;
alter table public.segnalazioni enable row level security;
alter table public.segnalazioni_eventi enable row level security;
revoke all on public.segnalazioni_settori, public.segnalazioni_motivi, public.segnalazioni, public.segnalazioni_eventi
	from anon, authenticated;

-- ── gli elenchi di partenza ────────────────────────────────────────────────

insert into public.segnalazioni_settori (chiave, nome, ordine) values
	('club', 'Club (in generale)', 10),
	('reception', 'Reception', 20),
	('parcheggio', 'Parcheggio', 30),
	('gym-floor', 'Gym Floor', 40),
	('dynamic-studio', 'Dynamic Studio', 50),
	('piscina-indoor', 'Piscina indoor', 60),
	('piscina-outdoor', 'Piscina outdoor', 70),
	('sauna', 'Sauna', 80),
	('bagno-turco', 'Bagno turco', 90),
	('relax-zone', 'Relax zone', 100),
	('spogliatoio-maschile-centrale', 'Spogliatoio maschile centrale', 110),
	('spogliatoio-femminile-centrale', 'Spogliatoio femminile centrale', 120),
	('spogliatoio-maschile-tennis', 'Spogliatoio maschile tennis', 130),
	('spogliatoio-femminile-tennis', 'Spogliatoio femminile tennis', 140),
	('armadietti', 'Armadietti', 150),
	('tennis', 'Tennis', 160),
	('padel', 'Padel', 170),
	('ristorante', 'Ristorante', 180),
	('altro', 'Altro', 999)
on conflict (chiave) do nothing;

insert into public.segnalazioni_motivi (chiave, nome, ordine) values
	('sovraffollamento', 'Sovraffollamento', 10),
	('posti-auto', 'Posti auto / parcheggio', 20),
	('segnaletica-parcheggio', 'Segnaletica del parcheggio', 30),
	('auto-danneggiata', 'Auto danneggiata', 40),
	('temperatura', 'Temperatura (caldo, freddo, acqua fredda)', 50),
	('aria-condizionata', 'Aria condizionata e ricircolo aria', 60),
	('riscaldamento', 'Riscaldamento', 70),
	('pulizie', 'Pulizie', 80),
	('vetri-sporchi', 'Vetri sporchi', 90),
	('odori', 'Odori e profumazione', 100),
	('wifi', 'Wi-Fi', 110),
	('macchina-ghiaccio', 'Macchina del ghiaccio', 120),
	('lettini-ombrelloni', 'Lettini e ombrelloni', 130),
	('asciugacostumi', 'Asciugacostumi', 140),
	('asciugamani', 'Asciugamani', 150),
	('serrature-armadietti', 'Serrature, armadietti e grucce', 160),
	('sauna-apertura', 'Apertura o accensione sauna', 170),
	('tornello', 'Tornello (ingresso del mattino)', 180),
	('macchinari', 'Macchinari vecchi o guasti', 190),
	('assistenza-sala', 'Assistenza in sala', 200),
	('arredi', 'Panche e arredi', 210),
	('ricarica-telefono', 'Cavi di ricarica telefono', 220),
	('rastrelliera-bici', 'Rastrelliera bici', 230),
	('acqua', 'Acqua assente', 240),
	('infestanti', 'Animali infestanti', 250),
	('sicurezza', 'Sicurezza (scalini, pavimento bagnato)', 260),
	('regolamento', 'Regolamento non rispettato', 270),
	('altro', 'Altro', 999)
on conflict (chiave) do nothing;

-- ── i permessi ─────────────────────────────────────────────────────────────

-- «segnalazioni» raccoglie e lavora le segnalazioni; «segnalazioni-report» è
-- il report per la direzione (gruppo Report, fuori dal corredo di un invito).
-- Parte da chi gestisce i ticket: gli altri operatori si abilitano da Gestione
-- utenti, uno alla volta, quando la sezione è pronta per loro.
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'segnalazioni')
where email in (select email from public.ticket_gestori)
	and not ('segnalazioni' = any (sezioni_consentite));

update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'segnalazioni-report')
where email in (select email from public.ticket_gestori)
	and not ('segnalazioni-report' = any (sezioni_consentite));
