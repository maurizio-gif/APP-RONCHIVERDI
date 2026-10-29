-- Collega le tessere CSI alle persone anche senza codice fiscale in comune.
--
-- Le tessere fatte dal portale CSI possono avere un codice fiscale diverso o
-- mancante rispetto al CRM. Secondo passaggio di collega_tessere_csi(): la
-- tessera ancora senza persona si lega alla persona con stesso cognome, nome
-- e data di nascita, ma solo se è l'unica che corrisponde (se ce ne sono due
-- non si indovina). Il primo passaggio, per codice fiscale, resta com'era.
-- Si può rieseguire senza danni.

alter table public.tessere_csi add column if not exists nascita date;

create or replace function public.collega_tessere_csi()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_toccate integer;
	v_nominativo integer;
begin
	with scelta as (
		select distinct on (upper(trim(codice_fiscale)))
			upper(trim(codice_fiscale)) as cf, id
		from public.persone
		where length(trim(coalesce(codice_fiscale, ''))) = 16
		order by upper(trim(codice_fiscale)), (source_utente_id is not null) desc, creato_il asc
	)
	update public.tessere_csi t
	set persona_id = s.id
	from scelta s
	where t.cft = s.cf and t.persona_id is distinct from s.id;
	get diagnostics v_toccate = row_count;

	-- Una tessera il cui codice fiscale non corrisponde più a nessuna persona
	-- perde il legame, a meno che non sia stato fatto per nominativo (sotto).
	update public.tessere_csi t
	set persona_id = null
	where t.persona_id is not null
		and not exists (
			select 1 from public.persone p
			where p.id = t.persona_id
				and (upper(trim(p.codice_fiscale)) = t.cft
					or (t.nascita is not null and p.data_nascita = t.nascita
						and upper(trim(p.cognome)) = upper(trim(t.cognome))
						and upper(trim(p.nome)) = upper(trim(t.nome))))
		);

	-- Per nominativo: cognome + nome + data di nascita, una sola persona.
	with cand as (
		select t.id as tessera_id, (array_agg(p.id))[1] as persona_id, count(*) as n
		from public.tessere_csi t
		join public.persone p
			on p.data_nascita = t.nascita
			and upper(trim(p.cognome)) = upper(trim(t.cognome))
			and upper(trim(p.nome)) = upper(trim(t.nome))
		where t.persona_id is null and t.nascita is not null
		group by t.id
	)
	update public.tessere_csi t
	set persona_id = c.persona_id
	from cand c
	where t.id = c.tessera_id and c.n = 1;
	get diagnostics v_nominativo = row_count;

	return v_toccate + v_nominativo;
end;
$$;

revoke all on function public.collega_tessere_csi() from public, anon, authenticated;
grant execute on function public.collega_tessere_csi() to service_role;
