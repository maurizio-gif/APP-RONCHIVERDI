-- Le transazioni di cassa di Info4U (dbo.CassaMovimenti) su Supabase: una
-- riga per movimento. Serve al report dell'INCASSATO, che è un'altra cosa
-- dal venduto di `abbonamenti`: una vendita rateale genera più movimenti
-- nel tempo, un annullamento genera movimenti negativi, e un quarto
-- dell'incassato (bonifici) non passa nemmeno dal cassetto.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), PRIMA di lanciare la nuova versione di
-- ops/sync-info4u/sync-abbonamenti.ps1.
--
-- Cosa si copia: i movimenti DAL 1 GENNAIO 2023 in poi (il parametro
-- TransazioniDal del sync), di ogni tipo, senza altri filtri. Cosa conta
-- come incassato è una decisione del report (vedi la vista in fondo), non
-- dell'importazione: se domani cambia, si cambia una vista e non si
-- reimporta niente.
--
-- Cosa NON si copia: NomeUtente (dato personale: si ricava da persona_id),
-- Note e il testo intero di Causale (campo libero da 2000 caratteri, può
-- contenere nomi: se ne tengono i primi 120).
--
-- Cose note sui dati (verificate su dbgym, dal 2022):
--   * tipo_servizio: A abbonamenti (~99% dell'incassato), C cauzioni
--     (prese e restituite da 60 €, somma ~0: NON è ricavo), I tesseramento,
--     P prenotazioni, O restituzioni/rimborsi, B borsellino, M varie.
--   * Eliminare una vendita in Info4U lascia i movimenti originali e ne
--     aggiunge uno negativo con causale «ABBONAMENTI: Elimina…»: sommando
--     tutti i movimenti l'incassato torna già netto. Quei movimenti hanno
--     source_iscrizione_id nullo.
--   * source_iscrizione_id può puntare a una vendita non più presente in
--     `abbonamenti` (cancellata): per questo non è una foreign key.
--   * I bonifici e i finanziamenti (Cofidis, Compass) hanno la data in cui
--     l'operatore li registra, non quella dell'accredito in banca.
--   * Esiste almeno un movimento datato nel futuro (2027): il report deve
--     filtrare data_operazione <= oggi.

create table if not exists public.transazioni (
	id uuid primary key default gen_random_uuid(),

	-- Chiave di upsert e watermark: IdCassaMovimento di Info4U.
	source_movimento_id integer not null unique,

	-- Chi ha pagato. persona_id lo riempie il trigger qui sotto a partire da
	-- source_utente_id; resta nullo se quell'utente non ha mai avuto una
	-- vendita (e quindi non è mai stato sincronizzato come persona).
	persona_id uuid references public.persone(id),
	source_utente_id integer,

	-- A cosa si riferisce. Senza foreign key apposta (vedi sopra).
	source_iscrizione_id integer,
	source_servizio_id integer,
	tipo_servizio text,
	descrizione_servizio text,
	causale text,

	data_operazione timestamptz,
	importo numeric(12, 2),

	-- Il metodo si copia come testo (CassaTipiPagamenti.Descrizione), così il
	-- report non deve decodificare gli ID. Il flag movimenta_cassa NON dice
	-- se è un incasso: il bonifico ha 0 ma è un quarto del totale.
	source_tipo_pagamento_id integer,
	metodo_pagamento text,
	movimenta_cassa boolean,

	-- Se valorizzato, questo movimento è lo storno di quell'altro.
	source_movimento_storno_id integer,

	operatore_id integer,
	operatore_nome text,
	cassetto text,

	-- Come in `abbonamenti`: movimento sparito da Info4U dopo il sync. Mai
	-- una DELETE, resta la traccia.
	cancellato_il timestamptz,

	sincronizzato_il timestamptz not null default now()
);

create index if not exists transazioni_data_operazione_idx on public.transazioni (data_operazione);
create index if not exists transazioni_persona_id_idx on public.transazioni (persona_id);
create index if not exists transazioni_source_utente_id_idx on public.transazioni (source_utente_id);
create index if not exists transazioni_source_iscrizione_id_idx on public.transazioni (source_iscrizione_id);
create index if not exists transazioni_cancellato_il_idx
	on public.transazioni (cancellato_il) where cancellato_il is not null;

-- Importi e movimenti: nessuna policy, quindi leggibile solo con la service
-- role (sync e Server Component), mai dal browser con la anon key.
alter table public.transazioni enable row level security;

-- persona_id dal source_utente_id, a ogni scrittura che lo lascia vuoto.
create or replace function public.transazioni_imposta_persona()
returns trigger
language plpgsql
as $$
begin
	if new.persona_id is null and new.source_utente_id is not null then
		select p.id into new.persona_id
		from public.persone p
		where p.source_utente_id = new.source_utente_id;
	end if;
	return new;
end;
$$;

drop trigger if exists transazioni_imposta_persona on public.transazioni;
create trigger transazioni_imposta_persona
	before insert or update of source_utente_id on public.transazioni
	for each row execute function public.transazioni_imposta_persona();

-- ─────────────────────────────────────────────────────────── incassato

-- Incassato per mese, tipo di servizio e metodo. Una vista sola e volutamente
-- larga: il report sceglie i tipi (di norma 'A', escluso 'C') e il periodo.
-- Esclude solo i movimenti spariti da Info4U e quelli con data nel futuro.
create or replace view public.incassato_mensile
with (security_invoker = true) as
select
	date_trunc('month', t.data_operazione)::date as mese,
	coalesce(t.tipo_servizio, '?') as tipo_servizio,
	coalesce(t.metodo_pagamento, 'Nessun metodo') as metodo_pagamento,
	count(*) as movimenti,
	sum(t.importo) as incassato
from public.transazioni t
where t.cancellato_il is null
  and t.data_operazione <= now()
group by 1, 2, 3;

comment on view public.incassato_mensile is
	'Incassato netto (somma algebrica dei movimenti di cassa di Info4U, storni ed eliminazioni inclusi) per mese, tipo_servizio e metodo di pagamento. Per il report abbonamenti: tipo_servizio = ''A''. Le cauzioni (''C'') non sono ricavo.';
