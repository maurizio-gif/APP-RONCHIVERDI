-- «Porta un amico»: un socio segnala un amico dalla landing della newsletter.
--
-- Da eseguire nel SQL Editor di Supabase. Il lead è l'AMICO — è lui che va
-- richiamato — e il socio che l'ha segnalato resta accanto a lui. Il sito
-- manda `origine = 'porta-un-amico'`, `attivita = 'club-adulti'` e il nome del
-- socio nei campi qui sotto; la campagna è nella UTM (`porta-un-amico`).
--
-- Senza questa migration la segnalazione viene salvata lo stesso (il sito
-- riprova senza le colonne nuove, e il nome del socio è nel messaggio) ma non
-- apre la trattativa con l'origine giusta.
--
-- Il trattamento è quello del walk-in e dell'evento — trattativa nuova e senza
-- assegnatario, così la prima venditrice disponibile la prende — con
-- `origine = 'porta-un-amico'` sulla trattativa. Solo additiva: le righe
-- esistenti non cambiano.

-- 1. Chi ha segnalato, e se l'amico ne è al corrente.
alter table public.form_contatti
	add column if not exists segnalato_da_nome text,
	add column if not exists segnalato_da_cognome text,
	add column if not exists amico_informato boolean;

comment on column public.form_contatti.segnalato_da_nome is
	'«Porta un amico»: nome del socio che ha segnalato, come l''ha scritto lui. Il collegamento alla sua scheda lo fa chi lavora il lead.';
comment on column public.form_contatti.segnalato_da_cognome is
	'«Porta un amico»: cognome del socio che ha segnalato, come l''ha scritto lui.';
comment on column public.form_contatti.amico_informato is
	'«Porta un amico»: il socio ha confermato che l''amico sa della segnalazione ed è d''accordo a essere contattato.';

-- 2. Il secondo attributo del lead: una segnalazione di un socio.
alter table public.opportunita drop constraint if exists opportunita_richiesta_check;
alter table public.opportunita
	add constraint opportunita_richiesta_check
	check (richiesta is null or richiesta in ('tour', 'richiamami', 'in_sede', 'telefonata', 'email', 'messaggio', 'mancato_rinnovo', 'segnalazione'));

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
		when p_origine = 'porta-un-amico' then 'segnalazione'
		else null
	end;
$$;

-- 3. La trattativa: come per il walk-in e l'evento, nuova e senza
--    assegnatario. Il resto della funzione è quella di
--    2026-10-15-origine-evento.sql, che è l'ultima versione.
create or replace function public.collega_persona_a_contatto()
returns trigger
language plpgsql
as $function$
declare
	v_walk_in boolean := new.origine = 'walk-in';
	v_evento boolean := new.origine = 'evento';
	v_amico boolean := new.origine = 'porta-un-amico';
begin
	begin
		new.persona_id := trova_o_crea_persona(new.nome, new.cognome, new.email, new.cellulare);

		if new.persona_id is not null
			and (v_walk_in or v_evento or v_amico or new.attivita in ('club-adulti', 'family'))
		then
			new.opportunita_id := trova_o_crea_opportunita(
				new.persona_id,
				case
					when v_walk_in then 'walk-in'
					when v_evento then 'evento'
					when v_amico then 'porta-un-amico'
					else null
				end,
				v_walk_in or v_evento or v_amico
			);
		end if;
	exception when others then
		raise warning 'Collegamento persona/trattativa non riuscito: %', sqlerrm;
	end;
	return new;
end;
$function$;

-- ──────────────────────────────────────────────────────── da verificare dopo

-- Dopo una segnalazione di prova dalla landing: deve risultare una riga con
-- origine 'porta-un-amico', il socio nelle colonne nuove, e la trattativa
-- aperta con la stessa origine e richiesta 'segnalazione'.
select f.created_at, f.nome, f.cognome, f.segnalato_da_nome, f.segnalato_da_cognome,
	f.amico_informato, o.origine as origine_trattativa, o.richiesta
from public.form_contatti f
left join public.opportunita o on o.id = f.opportunita_id
where f.origine = 'porta-un-amico'
order by f.created_at desc
limit 5;
