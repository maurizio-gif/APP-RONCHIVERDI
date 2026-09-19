-- Ricerca dei contatti sull'intera anagrafica, non solo sulle righe già
-- caricate in pagina.
--
-- L'elenco di /dashboard/persone ordina per ultima richiesta dal sito e
-- taglia a 500: chi non ha mai scritto dal sito — tutti i contatti
-- importati da Info4U, che possono essere migliaia — ha `ultima_richiesta`
-- nulla, finisce in fondo all'ordinamento e resta fuori dal taglio. La
-- ricerca in pagina filtrava solo dentro quelle 500 già caricate: cercandolo
-- per nome non lo si trovava comunque, semplicemente non c'era.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq).
--
-- Una funzione e non un filtro PostgREST composto lato client (`.or()` su
-- più colonne): la ricerca è a più parole — «mario rossi» deve trovare
-- nome=Mario, cognome=Rossi, colonne separate — e comporre quel filtro come
-- stringa a partire da un input libero vorrebbe dire costruire a mano la
-- sintassi dei filtri PostgREST (che usa `,` `.` `(` `)` come caratteri di
-- struttura) da un testo che l'operatore digita senza pensare a cosa contiene.
-- È esattamente il tipo di cosa che in questo progetto vive in una funzione
-- (vedi trova_o_crea_persona), parametrizzata e non concatenata.

create or replace function public.cerca_persone(p_query text, p_limite integer default 100)
returns table (
	id uuid,
	nome text,
	cognome text,
	email text,
	cellulare text,
	note text,
	fonte text,
	richieste bigint,
	richieste_da_lavorare bigint,
	prima_richiesta timestamptz,
	ultima_richiesta timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
	with termini as (
		select termine
		from unnest(regexp_split_to_array(btrim(coalesce(p_query, '')), '\s+')) as termine
		where termine <> ''
	)
	select
		p.id, p.nome, p.cognome, p.email, p.cellulare, p.note, p.fonte,
		count(f.id) as richieste,
		count(f.id) filter (where not f.gestito) as richieste_da_lavorare,
		min(f.created_at) as prima_richiesta,
		max(f.created_at) as ultima_richiesta
	from persone p
	left join form_contatti f on f.persona_id = p.id
	-- Ogni parola della query deve comparire da qualche parte fra i quattro
	-- campi, in qualunque ordine: stessa logica di testoRicerca (lib/persone.ts),
	-- qui su tutta la tabella invece che sulle righe già in memoria nel browser.
	where not exists (
		select 1 from termini t
		where (
			coalesce(p.nome, '') || ' ' || coalesce(p.cognome, '') || ' ' ||
			coalesce(p.email, '') || ' ' || coalesce(p.cellulare, '')
		) not ilike '%' || t.termine || '%'
	)
	group by p.id
	order by max(f.created_at) desc nulls last, p.cognome nulls last, p.nome nulls last
	limit greatest(p_limite, 1);
$$;

comment on function public.cerca_persone(text, integer) is
	'Cerca fra tutte le persone (non solo le più recenti caricate in pagina), su nome/cognome/email/cellulare insieme. Ogni parola della query deve comparire da qualche parte fra i quattro campi, in qualunque ordine — stessa logica della ricerca client di prima, ora sull''intera tabella invece che sulle sole righe già caricate.';

revoke all on function public.cerca_persone(text, integer) from public, anon, authenticated;
grant execute on function public.cerca_persone(text, integer) to service_role;
