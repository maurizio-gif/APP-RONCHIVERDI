-- Cerca in anagrafica per cellulare, confrontando solo le cifre.
--
-- Serve alla verifica «c'è già?» di Phone In / Email In
-- (cercaContattiPerVerifica in app/dashboard/agenda/actions.ts). Le due
-- strade che c'erano non bastano:
--
--  - cerca_persone confronta il testo: «388 751 3684» non trova
--    «3887513684», e «+39 3887513684» non trova nessuno dei due;
--  - cellulare_norm è nullo per quasi tutti i soci Info4U (18.097 su 18.235 a
--    ottobre 2026): la chiave di deduplicazione per loro è nome+cognome, e lì
--    il numero normalizzato non viene scritto.
--
-- Qui si tolgono i separatori dal cellulare com'è scritto e si cerca la
-- sequenza di cifre passata (chi chiama passa le ultime nove, senza
-- prefisso). Scansione intera della tabella: sono ~23.000 righe, e la si fa
-- solo quando qualcuno preme «Verifica».

create or replace function public.cerca_persone_per_cellulare(p_cifre text, p_limite integer default 20)
returns table (id uuid, nome text, cognome text, email text, cellulare text)
language sql
stable
security definer
set search_path to 'public'
as $$
	select p.id, p.nome, p.cognome, p.email, p.cellulare
	from persone p
	where length(regexp_replace(coalesce(p_cifre, ''), '[^0-9]', '', 'g')) >= 6
		and p.cellulare is not null
		and regexp_replace(p.cellulare, '[^0-9]', '', 'g')
			like '%' || regexp_replace(p_cifre, '[^0-9]', '', 'g') || '%'
	order by p.cognome nulls last, p.nome nulls last
	limit greatest(p_limite, 1);
$$;

-- Come cerca_persone: la chiama solo il server con la service role.
revoke all on function public.cerca_persone_per_cellulare(text, integer) from public, anon, authenticated;
grant execute on function public.cerca_persone_per_cellulare(text, integer) to service_role;
