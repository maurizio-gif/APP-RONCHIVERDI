-- Trattative: presa in carico e assegnazione delle richieste Club e Family.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-02-persone.sql.
--
-- La trattativa è della PERSONA, non della singola richiesta: tutte le
-- richieste Club/Family di quella persona confluiscono nella stessa, così due
-- commerciali non chiamano lo stesso cliente e non ci sono due assegnazioni
-- da tenere sincronizzate. È il modello del CRM del Tennis Club Ambrosiano,
-- dove le 459 opportunità stanno su 459 persone distinte: una per persona.
--
-- Vale solo per Abbonamento Club e Family, gli unici canali con un team che
-- se le prende in carico. Gli altri sei hanno un responsabile unico: il
-- canale è già l'assegnazione, e un campo "assegnata a" da compilare con
-- l'unica risposta possibile sarebbe solo lavoro in più.
--
-- Questo file è stato rigenerato dal database il 3 settembre 2026: prima era
-- un segnaposto e lo schema non era ricostruibile da qui.

-- ─────────────────────────────────────────────────────────── trattative

create table if not exists public.opportunita (
	id uuid primary key default gen_random_uuid(),
	creato_il timestamptz not null default now(),

	-- On delete cascade e non set null: una trattativa senza la persona non
	-- vuol dire niente, mentre la richiesta originale (form_contatti) resta
	-- comunque perché è il documento di partenza.
	persona_id uuid not null references public.persone (id) on delete cascade,

	stato text not null default 'nuovo'
		check (stato in ('nuovo', 'in_gestione', 'vinto', 'perso')),
	-- Chi ha cambiato lo stato e quando: li legge il trigger dello storico,
	-- che altrimenti non saprebbe attribuire il cambiamento a nessuno.
	stato_da text,
	stato_il timestamptz,

	assegnato_a text,
	assegnato_il timestamptz,
	assegnato_da text,

	-- Compilato solo quando lo stato è 'perso': perché si è perso.
	motivo_perso text,
	chiuso_il timestamptz,
	note text
);

comment on table public.opportunita is 'Trattativa commerciale di una persona, nata dalle richieste Club/Family. Una sola aperta per persona: quando si chiude (vinto/perso) resta nello storico e una richiesta successiva ne apre una nuova.';

create index if not exists opportunita_persona_idx on public.opportunita (persona_id);
create index if not exists opportunita_assegnato_idx on public.opportunita (assegnato_a);
-- Indice parziale sulle sole aperte: è la domanda che si fa il pannello
-- ("cosa resta da lavorare"), e le chiuse crescono senza limite.
create index if not exists opportunita_aperte_idx on public.opportunita (stato)
	where stato not in ('vinto', 'perso');

alter table public.opportunita enable row level security;
revoke all on public.opportunita from anon, authenticated;

-- Collegamento dalla richiesta alla trattativa. Set null e non cascade: se la
-- trattativa viene cancellata la richiesta resta, come sopra.
alter table public.form_contatti
	add column if not exists opportunita_id uuid references public.opportunita (id) on delete set null;

create index if not exists form_contatti_opportunita_idx on public.form_contatti (opportunita_id);

-- ───────────────────────────────────────────────────────────── storico

-- Ogni passaggio di stato o di mano, per rispondere a "chi l'ha persa e
-- quando". Tabella a parte e non colonne sulla trattativa: i cambiamenti sono
-- molti e la trattativa ne porterebbe solo l'ultimo.
create table if not exists public.opportunita_storico (
	id bigint primary key generated always as identity,
	opportunita_id uuid not null references public.opportunita (id) on delete cascade,
	cambiato_il timestamptz not null default now(),
	cambiato_da text,
	stato_precedente text,
	stato text,
	assegnato_precedente text,
	assegnato_a text
);

create index if not exists opportunita_storico_idx
	on public.opportunita_storico (opportunita_id, cambiato_il desc);

alter table public.opportunita_storico enable row level security;
revoke all on public.opportunita_storico from anon, authenticated;

-- ────────────────────────────────────────────── diritti dei commerciali

-- Due diritti distinti: prendere in carico una trattativa libera, e togliere
-- a un collega una che sta già seguendo. Il secondo è di pochi, altrimenti
-- l'assegnazione non vuol dire niente.
alter table public.staff_users
	add column if not exists commerciale boolean not null default false;

alter table public.staff_users
	add column if not exists puo_riassegnare boolean not null default false;

-- ──────────────────────────────────────────────────────────── funzioni

/**
 * La trattativa aperta di una persona, o una nuova.
 *
 * Se ne esiste già una non chiusa la si riusa: è il punto per cui una seconda
 * richiesta a pochi giorni di distanza non genera una seconda trattativa, e
 * non fa ripartire da "nuovo" qualcosa che un collega sta già seguendo.
 *
 * Se invece le precedenti sono tutte vinte o perse, la nuova eredita
 * l'assegnatario dell'ultima: chi seguiva quella persona continua a seguirla,
 * senza che qualcuno debba riassegnarla a mano.
 */
create or replace function public.trova_o_crea_opportunita(p_persona_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_id uuid;
	v_ultimo_assegnatario text;
begin
	if p_persona_id is null then return null; end if;

	select id into v_id
	from opportunita
	where persona_id = p_persona_id and stato not in ('vinto', 'perso')
	order by creato_il desc
	limit 1;

	if v_id is not null then return v_id; end if;

	select assegnato_a into v_ultimo_assegnatario
	from opportunita
	where persona_id = p_persona_id
	order by creato_il desc
	limit 1;

	insert into opportunita (persona_id, stato, assegnato_a, assegnato_il)
	values (
		p_persona_id,
		'nuovo',
		v_ultimo_assegnatario,
		case when v_ultimo_assegnatario is not null then now() else null end
	)
	returning id into v_id;

	return v_id;
end;
$$;

revoke all on function public.trova_o_crea_opportunita(uuid) from public, anon, authenticated;
grant execute on function public.trova_o_crea_opportunita(uuid) to service_role;

/**
 * Registra nello storico i cambiamenti di stato e di assegnatario.
 *
 * Solo AFTER UPDATE: la nascita di una trattativa non è un cambiamento, e la
 * sua data sta già in creato_il. Conseguenza da conoscere: una trattativa
 * appena creata non ha nessuna riga di storico.
 */
create or replace function public.registra_storico_opportunita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.stato is distinct from old.stato or new.assegnato_a is distinct from old.assegnato_a then
		insert into opportunita_storico (
			opportunita_id, cambiato_da, stato_precedente, stato, assegnato_precedente, assegnato_a
		) values (
			new.id,
			coalesce(new.stato_da, new.assegnato_da),
			old.stato,
			new.stato,
			old.assegnato_a,
			new.assegnato_a
		);
	end if;
	return new;
end;
$$;

drop trigger if exists opportunita_storico_trigger on public.opportunita;
create trigger opportunita_storico_trigger
	after update on public.opportunita
	for each row
	execute function public.registra_storico_opportunita();

-- ────────────────────────────── il trigger su form_contatti, versione finale

/**
 * Aggancia ogni nuova richiesta alla sua persona e, per Club e Family, alla
 * sua trattativa. Sostituisce la versione di 2026-09-02-persone.sql, che
 * conosceva solo le persone: questa è quella in produzione.
 *
 * L'eccezione è catturata di proposito: se il collegamento fallisce la
 * richiesta deve entrare comunque. Un lead perso è un danno vero, un
 * collegamento mancante si sistema dopo — e `persona_id` NON viene azzerato,
 * perché se la persona era già stata trovata quel collegamento è buono anche
 * se è la trattativa a essere fallita.
 */
create or replace function public.collega_persona_a_contatto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	begin
		new.persona_id := trova_o_crea_persona(new.nome, new.cognome, new.email, new.cellulare);

		if new.persona_id is not null and new.attivita in ('club-adulti', 'family') then
			new.opportunita_id := trova_o_crea_opportunita(new.persona_id);
		end if;
	exception when others then
		raise warning 'Collegamento persona/trattativa non riuscito: %', sqlerrm;
	end;
	return new;
end;
$$;

drop trigger if exists form_contatti_collega_persona on public.form_contatti;
create trigger form_contatti_collega_persona
	before insert on public.form_contatti
	for each row
	execute function public.collega_persona_a_contatto();

-- ──────────────────────────────────────────────────────────────── backfill

-- Le richieste Club/Family già in tabella, dalla più vecchia: l'ordine conta,
-- perché la prima crea la trattativa e le successive le si agganciano.
do $$
declare
	r record;
begin
	for r in select id, persona_id from form_contatti
		where opportunita_id is null and persona_id is not null
			and attivita in ('club-adulti', 'family')
		order by created_at loop
		begin
			update form_contatti
			set opportunita_id = trova_o_crea_opportunita(r.persona_id)
			where id = r.id;
		exception when others then
			raise warning 'Backfill trattativa non riuscito per %: %', r.id, sqlerrm;
		end;
	end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────── vista

-- Una riga per trattativa con la persona già dentro e quante richieste ha
-- portato: è quello che serve a un elenco di trattative senza una query per
-- riga.
create or replace view public.trattative as
select
	o.id,
	o.creato_il,
	o.stato,
	o.assegnato_a,
	o.assegnato_il,
	o.chiuso_il,
	o.motivo_perso,
	o.note,
	p.id as persona_id,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	count(f.id) as richieste,
	max(f.created_at) as ultima_richiesta
from public.opportunita o
	join public.persone p on p.id = o.persona_id
	left join public.form_contatti f on f.opportunita_id = o.id
group by o.id, p.id;

alter view public.trattative set (security_invoker = on);
revoke all on public.trattative from anon, authenticated;
grant select on public.trattative to service_role;
