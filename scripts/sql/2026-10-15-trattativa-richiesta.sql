-- Il secondo attributo di un lead: **cosa ha chiesto**, accanto a **dove è
-- nato** (opportunita.origine, vedi lib/provenienza.ts).
--
--   canale      — Sito web · Walk-in (Guest Register) · Phone In / Email In · Agenda
--   richiesta   — tour        tour in sede con giorno e ora (dal sito o al banco)
--                 richiamami  «Richiamami» dal sito, con una fascia oraria
--                 in_sede     registrato al Guest Register senza tour: è lì,
--                             il tour si fa subito
--                 telefonata  Phone In: la segreteria ha registrato una
--                             telefonata (o una telefonata prenotata dal sito,
--                             quando si poteva)
--                 email       Phone In: un'email arrivata alla segreteria
--                 messaggio   il messaggio libero del vecchio modulo del sito
--                             (fino a ottobre 2026, prima del Richiamami)
--                 null        creata in agenda: nessuna richiesta dietro
--
-- Sta sulla trattativa e non si ricalcola: la scrive una volta la prima
-- richiesta che la apre (trigger qui sotto), o Phone In quando la crea
-- (assegnaTrattativaDaEvento). Una richiesta successiva della stessa persona
-- non la cambia — il lead è nato così. Così ogni elenco e ogni report la
-- leggono dalla trattativa, senza cercare la sua prima richiesta.

alter table public.opportunita
	add column if not exists richiesta text;

alter table public.opportunita
	drop constraint if exists opportunita_richiesta_check;
alter table public.opportunita
	add constraint opportunita_richiesta_check
	check (richiesta is null or richiesta in ('tour', 'richiamami', 'in_sede', 'telefonata', 'email', 'messaggio'));

comment on column public.opportunita.richiesta is
	'Cosa ha chiesto chi ha aperto il lead: tour, richiamami, in_sede, telefonata, email, messaggio (null = creata in agenda). Vedi scripts/sql/2026-10-15-trattativa-richiesta.sql.';

-- Da una richiesta del sito o del banco al valore di `richiesta`.
create or replace function public.richiesta_da_azione(p_azione text, p_origine text)
returns text
language sql
immutable
as $$
	select case
		when p_azione = 'appuntamento' then 'tour'
		when p_azione = 'richiamami' then 'richiamami'
		when p_azione = 'telefonata' then 'telefonata'
		when p_azione = 'messaggio' then 'messaggio'
		when p_origine = 'walk-in' then 'in_sede'
		else null
	end;
$$;

-- La prima richiesta che apre (o trova) la trattativa le scrive cosa ha
-- chiesto, se non lo sa già. collega_persona_a_contatto, prima
-- dell'inserimento, ha già messo opportunita_id sulla riga.
create or replace function public.richiesta_sulla_trattativa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
	if new.opportunita_id is not null then
		update opportunita
		set richiesta = richiesta_da_azione(new.azione, new.origine)
		where id = new.opportunita_id and richiesta is null;
	end if;
	return new;
exception when others then
	-- La richiesta non deve fallire per un'etichetta.
	raise warning 'Richiesta sulla trattativa non scritta: %', sqlerrm;
	return new;
end;
$$;

drop trigger if exists form_contatti_richiesta_sulla_trattativa on public.form_contatti;
create trigger form_contatti_richiesta_sulla_trattativa
	after insert or update of opportunita_id on public.form_contatti
	for each row
	execute function public.richiesta_sulla_trattativa();

-- Le trattative che ci sono già: dalla loro prima richiesta.
update opportunita o
set richiesta = sub.richiesta
from (
	select distinct on (f.opportunita_id)
		f.opportunita_id, richiesta_da_azione(f.azione, f.origine) as richiesta
	from form_contatti f
	where f.opportunita_id is not null
	order by f.opportunita_id, f.created_at
) sub
where o.id = sub.opportunita_id and o.richiesta is null and sub.richiesta is not null;
