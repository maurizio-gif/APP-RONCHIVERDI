-- Fonte "evento": chi si registra dal QR code di un evento.
--
-- Da eseguire nel SQL Editor di Supabase. Il sito manda `origine = 'evento'`
-- quando il guest register è aperto con ?utm_source=evento: senza questa
-- migration la richiesta viene salvata lo stesso (origine è testo libero) ma
-- non apre la trattativa da assegnare.
--
-- Il trattamento è quello del walk-in — opportunità nuova e senza assegnatario,
-- così la prima venditrice disponibile la prende — con due differenze: l'origine
-- sulla trattativa resta 'evento', e `richiesta` resta nulla (non è un
-- passaggio in sede, quindi 'in_sede' sarebbe falso).

create or replace function public.collega_persona_a_contatto()
returns trigger
language plpgsql
as $function$
declare
	v_walk_in boolean := new.origine = 'walk-in';
	v_evento boolean := new.origine = 'evento';
begin
	begin
		new.persona_id := trova_o_crea_persona(new.nome, new.cognome, new.email, new.cellulare);

		if new.persona_id is not null
			and (v_walk_in or v_evento or new.attivita in ('club-adulti', 'family'))
		then
			new.opportunita_id := trova_o_crea_opportunita(
				new.persona_id,
				case when v_walk_in then 'walk-in' when v_evento then 'evento' else null end,
				v_walk_in or v_evento
			);
		end if;
	exception when others then
		raise warning 'Collegamento persona/trattativa non riuscito: %', sqlerrm;
	end;
	return new;
end;
$function$;
