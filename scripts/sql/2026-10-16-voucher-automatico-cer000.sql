-- Voucher automatico per gli abbonamenti "(cer000)".
--
-- Nel gestionale i prodotti che includono la visita medica portano la sigla
-- "(cer000)" nel nome (oggi «1.1 GOLD OVER 35 (cer000)»). Ogni nuova vendita
-- di uno di questi prodotti deve far partire da sola l'email con il codice,
-- senza che la segreteria lo emetta a mano. Lo fa il cron
-- /api/cron/voucher-automatico (lib/voucher-automatico.ts), che legge
-- `abbonamenti` così come lo scrive la sincronizzazione Info4U.
--
-- Due pezzi:
--
-- 1. `voucher.abbonamento_id`: la vendita da cui è nato il voucher. L'indice
--    unico è la garanzia che una vendita non produca mai due codici, anche
--    se due giri del cron si sovrappongono. Resta vuoto per i voucher
--    emessi a mano. I dati del socio restano comunque copiati sul voucher
--    (vedi 2026-09-05-voucher.sql): questo è solo il collegamento.
--
-- 2. `automazioni`: l'interruttore. Una riga per automazione, spenta finché
--    qualcuno non la accende. `attiva_dal` è il punto di partenza: contano
--    solo le vendite registrate da quel momento in poi, così all'accensione
--    non partono email per gli abbonamenti già venduti. Sta nel database e
--    non in una variabile d'ambiente perché accendere e spegnere non deve
--    richiedere un deploy.
--
-- ACCENSIONE (da fare solo su via libera):
--   update public.automazioni
--      set attiva = true, attiva_dal = now(), aggiornato_il = now()
--    where chiave = 'voucher_cer000';
--
-- SPEGNIMENTO:
--   update public.automazioni
--      set attiva = false, aggiornato_il = now()
--    where chiave = 'voucher_cer000';

alter table public.voucher
	add column if not exists abbonamento_id uuid references public.abbonamenti(id) on delete set null;

create unique index if not exists voucher_abbonamento_unico
	on public.voucher (abbonamento_id)
	where abbonamento_id is not null;

comment on column public.voucher.abbonamento_id is
	'La vendita da cui è nato il voucher automatico; vuoto per quelli emessi a mano.';

create table if not exists public.automazioni (
	chiave text primary key,
	attiva boolean not null default false,
	attiva_dal timestamptz,
	descrizione text,
	aggiornato_il timestamptz not null default now()
);

-- Come `voucher`: RLS accesa e nessuna policy, la legge solo il server con
-- la service role key.
alter table public.automazioni enable row level security;

insert into public.automazioni (chiave, attiva, descrizione)
values (
	'voucher_cer000',
	false,
	'Email con il codice della visita medica per ogni nuovo abbonamento "(cer000)".'
)
on conflict (chiave) do nothing;

-- Verifica: deve restituire attiva = false.
select chiave, attiva, attiva_dal from public.automazioni;
