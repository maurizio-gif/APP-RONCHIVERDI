-- Il piano rate di Info4U (dbo.AbbonamentiPagamenti) su Supabase: una riga per
-- rata. Serve a distinguere, nel report dell'incassato, una rata futura (a
-- posto) da una rata scaduta e non pagata (insoluto) e da una differenza che
-- nessuna rata spiega (da controllare).
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, DOPO
-- 2026-10-07-transazioni-cassa.sql e 2026-10-07-incassato-report.sql, e PRIMA
-- di lanciare la nuova versione di ops/sync-info4u/sync-abbonamenti.ps1.
--
-- Cosa si copia: le rate con scadenza (o pagamento) dal 1 gennaio 2023 in poi
-- — lo stesso confine delle transazioni — più quelle senza data.
--
-- Una rata pagata punta al movimento di cassa che l'ha incassata
-- (source_movimento_id): il legame fra piano rate e transazioni.

create table if not exists public.abbonamenti_rate (
	id uuid primary key default gen_random_uuid(),

	-- IDRata di Info4U: chiave di upsert e watermark.
	source_rata_id integer not null unique,

	-- La vendita a cui appartiene. Senza foreign key: può puntare a una
	-- vendita non più presente (cancellata in Info4U).
	source_iscrizione_id integer,
	-- Il movimento di cassa con cui è stata pagata (IDCassaMovimento).
	source_movimento_id integer,

	data_rata date,
	importo numeric(12, 2),
	data_pagato timestamptz,

	source_tipo_pagamento_id integer,
	metodo_pagamento text,
	operatore_id integer,
	operatore_nome text,

	-- L'esito dell'addebito automatico (carta/SEPA via TSPay): se la banca
	-- l'ha rifiutato, qui c'è il motivo. Per chi controlla gli insoluti è il
	-- dato più utile della tabella.
	transazione_errore text,
	transazione_data timestamptz,

	-- Come in `abbonamenti` e `transazioni`: rata sparita da Info4U dopo il
	-- sync. Mai una DELETE.
	cancellato_il timestamptz,

	sincronizzato_il timestamptz not null default now()
);

create index if not exists abbonamenti_rate_iscrizione_idx on public.abbonamenti_rate (source_iscrizione_id);
create index if not exists abbonamenti_rate_data_rata_idx on public.abbonamenti_rate (data_rata);
create index if not exists abbonamenti_rate_movimento_idx on public.abbonamenti_rate (source_movimento_id)
	where source_movimento_id is not null;
create index if not exists abbonamenti_rate_cancellato_il_idx
	on public.abbonamenti_rate (cancellato_il) where cancellato_il is not null;

alter table public.abbonamenti_rate enable row level security;

-- ───────────────────────────────────────────────────────── rate_abbonamenti

-- La rata con il suo stato, la vendita e la persona. Lo stato si calcola al
-- giorno di Roma di oggi:
--   pagata     ha data_pagato
--   insoluta   non pagata e scaduta (data_rata prima di oggi)
--   da_pagare  non pagata, scade oggi o dopo
create or replace view public.rate_abbonamenti
with (security_invoker = true) as
select
	r.id,
	r.source_rata_id,
	r.source_iscrizione_id,
	r.source_movimento_id,
	r.data_rata,
	r.importo,
	r.data_pagato,
	r.metodo_pagamento,
	r.operatore_nome,
	r.transazione_errore,
	r.transazione_data,
	case
		when r.data_pagato is not null then 'pagata'
		when r.data_rata < (now() at time zone 'Europe/Rome')::date then 'insoluta'
		else 'da_pagare'
	end as stato,
	case
		when r.data_pagato is null and r.data_rata < (now() at time zone 'Europe/Rome')::date
			then (now() at time zone 'Europe/Rome')::date - r.data_rata
	end as giorni_ritardo,
	a.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	a.data_vendita,
	a.totale as vendita_totale,
	(a.id is null) as vendita_assente
from public.abbonamenti_rate r
left join public.abbonamenti a on a.source_iscrizione_id = r.source_iscrizione_id and a.cancellato_il is null
left join public.persone p on p.id = a.persona_id
where r.cancellato_il is null;

comment on view public.rate_abbonamenti is
	'Una riga per rata del piano di pagamento di Info4U, con stato (pagata / insoluta / da_pagare), giorni di ritardo, vendita e persona. vendita_assente = la vendita non è più nel CRM (cancellata in Info4U).';

-- ──────────────────────────────────────────── abbonamenti_incassato (rate)

-- La vista per vendita già esistente, con in più il piano rate: così per ogni
-- vendita «da incassare» si vede quanto è spiegato da rate future, quanto da
-- rate scadute e non pagate, e quanto resta senza spiegazione. Le colonne
-- nuove stanno in fondo: create or replace non permette di inserirne prima.
create or replace view public.abbonamenti_incassato
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
	coalesce(a.totale, 0) as venduto,
	coalesce(i.incassato, 0) as incassato,
	coalesce(i.movimenti, 0) as movimenti,
	i.ultimo_incasso,
	coalesce(a.totale, 0) - coalesce(i.incassato, 0) as differenza,
	coalesce(rt.rate_totali, 0) as rate_totali,
	coalesce(rt.rate_pagate, 0) as rate_pagate,
	coalesce(rt.rate_insolute, 0) as rate_insolute,
	coalesce(rt.importo_insoluto, 0) as importo_insoluto,
	coalesce(rt.importo_da_pagare, 0) as importo_da_pagare
from public.abbonamenti a
left join public.persone p on p.id = a.persona_id
left join lateral (
	select sum(t.importo) as incassato,
	       count(*) as movimenti,
	       max(t.data_operazione) as ultimo_incasso
	from public.transazioni t
	where t.source_iscrizione_id = a.source_iscrizione_id
	  and t.cancellato_il is null
	  and t.data_operazione <= now()
) i on true
left join lateral (
	select count(*) as rate_totali,
	       count(*) filter (where r.data_pagato is not null) as rate_pagate,
	       count(*) filter (where r.data_pagato is null
	                          and r.data_rata < (now() at time zone 'Europe/Rome')::date) as rate_insolute,
	       coalesce(sum(r.importo) filter (where r.data_pagato is null
	                          and r.data_rata < (now() at time zone 'Europe/Rome')::date), 0) as importo_insoluto,
	       coalesce(sum(r.importo) filter (where r.data_pagato is null
	                          and r.data_rata >= (now() at time zone 'Europe/Rome')::date), 0) as importo_da_pagare
	from public.abbonamenti_rate r
	where r.source_iscrizione_id = a.source_iscrizione_id
	  and r.cancellato_il is null
) rt on true
where a.cancellato_il is null;
