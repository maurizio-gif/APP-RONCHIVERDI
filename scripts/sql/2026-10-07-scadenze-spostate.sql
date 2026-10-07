-- Sospensioni = scadenza spostata a mano. In Info4U le sospensioni di oggi non
-- sono registrate da nessuna parte (le tabelle AbbonamentiSospensioni e
-- Sospensioni sono ferme a marzo 2025, e le colonne sospensione delle
-- vendite pure): l'operatore sposta in avanti la data di fine
-- dell'abbonamento. Il CRM la vede in due modi:
--
--   1. scadenze_spostate  confronta la data di fine con quella che
--      l'abbonamento dovrebbe avere dalla sua durata (inizio + durata in mesi
--      meno un giorno). Verificato sui dati dal 2025: 6.583 abbonamenti
--      mensili su ~8.200 coincidono al giorno, gli altri sono spostati
--      (61 di 4-14 giorni, 498 di 15-45, 344 oltre 45). Soglia: oltre 3
--      giorni, sotto sono arrotondamenti di fine mese. Vale per gli
--      abbonamenti a mesi (periodo M); non può distinguere una sospensione
--      da un mese omaggio o da una correzione.
--   2. abbonamenti_scadenze_variazioni  da oggi registra ogni volta che la
--      data di fine di una vendita cambia (data e ora in cui il sync se ne
--      accorge: entro un giorno dallo spostamento).
--
-- Info4U non dice CHI ha spostato la scadenza: l'operatore non c'è.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi.

-- ──────────────────────────────────── abbonamenti_scadenze_variazioni

create table if not exists public.abbonamenti_scadenze_variazioni (
	id uuid primary key default gen_random_uuid(),
	abbonamento_id uuid not null references public.abbonamenti(id) on delete cascade,
	source_iscrizione_id integer,
	data_fine_precedente date,
	data_fine_nuova date,
	-- Di quanto si è spostata (negativo = anticipata, per esempio una disdetta).
	giorni integer,
	rilevata_il timestamptz not null default now()
);

create index if not exists abbonamenti_scadenze_variazioni_rilevata_idx
	on public.abbonamenti_scadenze_variazioni (rilevata_il desc);
create index if not exists abbonamenti_scadenze_variazioni_abbonamento_idx
	on public.abbonamenti_scadenze_variazioni (abbonamento_id);

alter table public.abbonamenti_scadenze_variazioni enable row level security;

create or replace function public.abbonamenti_registra_variazione_scadenza()
returns trigger
language plpgsql
as $$
begin
	-- Solo se la data c'era già e cambia: la prima scrittura di una vendita
	-- nuova non è uno spostamento.
	if old.data_fine is not null and new.data_fine is not null and new.data_fine <> old.data_fine then
		insert into public.abbonamenti_scadenze_variazioni
			(abbonamento_id, source_iscrizione_id, data_fine_precedente, data_fine_nuova, giorni)
		values (new.id, new.source_iscrizione_id, old.data_fine, new.data_fine, new.data_fine - old.data_fine);
	end if;
	return new;
end;
$$;

drop trigger if exists abbonamenti_registra_variazione_scadenza on public.abbonamenti;
create trigger abbonamenti_registra_variazione_scadenza
	after update of data_fine on public.abbonamenti
	for each row execute function public.abbonamenti_registra_variazione_scadenza();

-- ─────────────────────────────────────────────────── scadenze_spostate

create or replace view public.scadenze_spostate
with (security_invoker = true) as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	a.data_vendita,
	a.data_inizio,
	(a.data_inizio + a.durata * interval '1 month' - interval '1 day')::date as scadenza_prevista,
	a.data_fine,
	a.data_fine - (a.data_inizio + a.durata * interval '1 month' - interval '1 day')::date as giorni_spostati,
	(a.data_fine >= (now() at time zone 'Europe/Rome')::date) as attiva,
	a.data_disdetta,
	-- Quando il CRM ha visto cambiare la scadenza l'ultima volta (se è successo
	-- da quando c'è il registro): serve a ordinare le più recenti in alto.
	(select max(v.rilevata_il) from public.abbonamenti_scadenze_variazioni v where v.abbonamento_id = a.id) as ultima_variazione_il
from public.abbonamenti a
left join public.persone p on p.id = a.persona_id
where a.cancellato_il is null
  and a.periodo = 'M'
  and a.durata > 0
  and a.data_inizio >= date '2023-01-01'
  and a.data_fine is not null
  and a.data_fine - (a.data_inizio + a.durata * interval '1 month' - interval '1 day')::date > 3;

comment on view public.scadenze_spostate is
	'Abbonamenti a mesi, iniziati dal 2023, la cui data di fine supera di oltre 3 giorni inizio + durata: in pratica sospensioni (o mesi omaggio) inseriti spostando a mano la scadenza. giorni_spostati = di quanto.';
