-- Voucher: un codice monouso che dà diritto a una prestazione presso un
-- partner. Nasce per la visita medica inclusa negli abbonamenti oltre
-- €1.000 (partnership Chiron), ma la tabella non parla di medicina: `tipo`
-- distingue il benefit, così lo stesso motore serve il prossimo — il ritiro
-- del merchandising, un ingresso omaggio — senza una tabella nuova.
--
-- Perché i dati del socio sono copiati qui e non presi da `persone`: il
-- voucher è un documento consegnato, e deve restare leggibile com'era il
-- giorno in cui è partito, anche se l'anagrafica cambia o la persona viene
-- unita a un'altra. In questa fase l'inserimento è a mano dalla segreteria:
-- non c'è ancora l'estrazione notturna dal gestionale, e quando arriverà
-- scriverà su questa stessa tabella.
--
-- Nessun dato sanitario, qui: solo chi ha diritto alla visita e se il codice
-- è stato speso. Il certificato non passa da questo sistema — arriva dal
-- socio alla casella dedicata.

create table if not exists public.voucher (
	id uuid primary key default gen_random_uuid(),

	-- Numerico e corto perché si detta al telefono: Chiron prenota così, e un
	-- QR non si legge a voce. L'unicità è il vincolo che regge tutto il resto.
	codice text not null unique,

	tipo text not null default 'visita_medica',

	-- Il destinatario, come scritto sul voucher.
	nome text not null,
	cognome text not null,
	email text not null,
	telefono text,

	-- Note della segreteria (numero di contratto, prodotto venduto): non
	-- finiscono nell'email al socio.
	note text,

	stato text not null default 'attivo',

	emesso_da text,
	created_at timestamptz not null default now(),
	valido_fino date not null,

	-- La bruciatura: chi l'ha fatta è il partner che ha validato dal suo
	-- accesso, non un operatore del pannello.
	utilizzato_il timestamptz,
	utilizzato_da text,

	annullato_il timestamptz,
	annullato_da text,

	-- Tracciamento dell'email di assegnazione: quante volte è partita,
	-- quando l'ultima, e l'ultimo errore se non è partita. Serve alla
	-- segreteria per sapere se rimandarla, senza aprire i log di SendGrid.
	email_inviata_il timestamptz,
	email_invii integer not null default 0,
	email_errore text
);

alter table public.voucher
	drop constraint if exists voucher_stato_check;

alter table public.voucher
	add constraint voucher_stato_check
	check (stato in ('attivo', 'utilizzato', 'annullato'));

comment on table public.voucher is
	'Voucher monouso per benefit ai soci (prima applicazione: visita medica Chiron inclusa negli abbonamenti oltre soglia).';
comment on column public.voucher.codice is
	'Codice numerico dettato al telefono al partner. Unico su tutta la tabella.';
comment on column public.voucher.stato is
	'attivo | utilizzato | annullato. La scadenza NON è uno stato: si ricava da valido_fino.';
comment on column public.voucher.utilizzato_da is
	'Chi ha bruciato il codice dall''interfaccia di validazione del partner.';

-- L'elenco della segreteria è sempre "i più recenti prima", filtrati per
-- stato; la verifica del partner cerca per codice, che è già unique.
create index if not exists voucher_created_at_idx on public.voucher (created_at desc);
create index if not exists voucher_stato_idx on public.voucher (stato);
create index if not exists voucher_email_idx on public.voucher (lower(email));

-- RLS attiva e nessuna policy: si entra solo con la service role key dalle
-- Server Action del pannello, come per le altre tabelle amministrative. Un
-- client col solo anon key non vede niente.
alter table public.voucher enable row level security;
