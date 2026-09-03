-- Anagrafica deduplicata: la stessa persona compila più form nel tempo e qui
-- ha una riga sola.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-02-staff-e-audit.sql.
--
-- Come in AppTCA la deduplicazione la fa il database, non l'applicazione: un
-- trigger su form_contatti chiama trova_o_crea_persona a ogni nuova richiesta,
-- così un modulo futuro (iscrizioni eventi, un altro form di pagina) si
-- aggancia chiamando la stessa funzione, senza riscrivere la logica.

create table if not exists public.persone (
	id uuid primary key default gen_random_uuid(),
	creato_il timestamptz not null default now(),
	aggiornato_il timestamptz not null default now(),

	nome text,
	cognome text,
	-- Da dove viene la riga: 'form_contatti' per chi ha scritto dal sito,
	-- 'migrazione' per chi è stato importato.
	fonte text,
	-- Una persona importata e mai manifestatasi: sta in anagrafica per
	-- riconoscerla se scrive, ma non è un contatto che ha chiesto qualcosa.
	-- Torna false appena arriva una sua richiesta (vedi trova_o_crea_persona).
	storico boolean not null default false,
	-- Sempre in minuscolo e senza spazi: è una delle due chiavi di
	-- deduplicazione, e "Mario@Example.it " e "mario@example.it" sono la
	-- stessa persona.
	email text,
	-- Il numero come l'ha scritto la persona, per mostrarlo e chiamarlo.
	cellulare text,
	-- Le sole cifre significative del numero (vedi normalizza_cellulare):
	-- l'altra chiave di deduplicazione, perché "+39 333 1234567",
	-- "3331234567" e "0039 333 1234567" sono lo stesso telefono.
	cellulare_norm text,

	note text
);

comment on table public.persone is 'Anagrafica deduplicata: una riga per persona, con tutte le sue richieste collegate via persona_id. La deduplicazione la fa il database (trova_o_crea_persona), chiamata dal trigger su form_contatti.';
comment on column public.persone.cellulare_norm is 'Cifre significative del cellulare, usate per il confronto: vedi normalizza_cellulare.';

-- Le chiavi di deduplicazione sono univoche solo quando ci sono: una persona
-- di cui conosciamo solo l'email non deve bloccare le altre senza telefono.
create unique index if not exists persone_email_idx on public.persone (email) where email is not null;
create unique index if not exists persone_cellulare_idx on public.persone (cellulare_norm) where cellulare_norm is not null;
create index if not exists persone_cognome_idx on public.persone (cognome, nome);
create index if not exists persone_fonte_idx on public.persone (fonte) where fonte is not null;

alter table public.persone enable row level security;
revoke all on public.persone from anon, authenticated;

-- Collegamento dalle richieste alla persona. Con on delete set null: se una
-- persona viene unita a un'altra o cancellata, la richiesta resta — è il
-- documento originale, e perderlo per una correzione di anagrafica sarebbe
-- peggio del duplicato che si stava sistemando.
alter table public.form_contatti
	add column if not exists persona_id uuid references public.persone (id) on delete set null;

create index if not exists form_contatti_persona_idx on public.form_contatti (persona_id);

-- ────────────────────────────────────────────────────── normalizzazioni

/**
 * Cifre significative di un numero italiano: via tutto ciò che non è cifra,
 * poi il prefisso internazionale (0039 o 39) quando resta un numero di
 * lunghezza plausibile. Si tengono le ultime 10 cifre, che è quanto basta a
 * riconoscere lo stesso cellulare scritto in modi diversi.
 *
 * Ritorna null per stringhe troppo corte per essere un telefono: meglio
 * nessuna chiave che una chiave che accomuna persone diverse.
 */
create or replace function public.normalizza_cellulare(p_numero text)
returns text
language plpgsql
immutable
as $$
declare
	v_cifre text;
begin
	if p_numero is null then return null; end if;

	v_cifre := regexp_replace(p_numero, '[^0-9]', '', 'g');

	if length(v_cifre) > 11 and left(v_cifre, 4) = '0039' then
		v_cifre := substr(v_cifre, 5);
	elsif length(v_cifre) > 10 and left(v_cifre, 2) = '39' then
		v_cifre := substr(v_cifre, 3);
	end if;

	if length(v_cifre) < 8 then return null; end if;

	return right(v_cifre, 10);
end;
$$;

create or replace function public.normalizza_email(p_email text)
returns text
language sql
immutable
as $$
	select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

-- ─────────────────────────────────────────── deduplicazione

/**
 * Trova la persona che corrisponde a questi contatti, o la crea.
 *
 * L'email ha precedenza sul telefono: è il dato che le persone scrivono in
 * modo più stabile, mentre un numero di casa può essere condiviso da più
 * familiari. Se non corrisponde nulla, si crea.
 *
 * Sulla riga trovata si completano solo i campi vuoti, mai sovrascrivendo un
 * valore già presente: un form compilato in fretta, con il nome abbreviato,
 * non deve peggiorare un'anagrafica già buona.
 */
create or replace function public.trova_o_crea_persona(
	p_nome text,
	p_cognome text,
	p_email text,
	p_cellulare text,
	p_fonte text default 'form_contatti'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_email text := normalizza_email(p_email);
	v_norm text := normalizza_cellulare(p_cellulare);
	v_id uuid;
begin
	-- Senza nessuna delle due chiavi non si può deduplicare: creare una riga
	-- qui vorrebbe dire un duplicato garantito al contatto successivo.
	if v_email is null and v_norm is null then
		return null;
	end if;

	-- L'email ha precedenza sul telefono: è il dato che le persone scrivono
	-- in modo più stabile, mentre un numero di casa può essere condiviso.
	if v_email is not null then
		select id into v_id from persone where email = v_email limit 1;
	end if;

	if v_id is null and v_norm is not null then
		select id into v_id from persone where cellulare_norm = v_norm limit 1;
	end if;

	if v_id is null then
		insert into persone (nome, cognome, email, cellulare, cellulare_norm, fonte, storico)
		values (
			nullif(btrim(coalesce(p_nome, '')), ''),
			nullif(btrim(coalesce(p_cognome, '')), ''),
			v_email,
			p_cellulare,
			v_norm,
			p_fonte,
			p_fonte = 'migrazione'
		)
		returning id into v_id;
		return v_id;
	end if;

	-- Sulla riga trovata si completano solo i campi vuoti, mai sovrascrivendo
	-- un valore presente: un form compilato in fretta non deve peggiorare
	-- un'anagrafica già buona. E una persona importata che poi scrive dal
	-- sito smette di essere "storico": si è manifestata davvero.
	update persone set
		nome = coalesce(nome, nullif(btrim(coalesce(p_nome, '')), '')),
		cognome = coalesce(cognome, nullif(btrim(coalesce(p_cognome, '')), '')),
		email = coalesce(email, v_email),
		cellulare = coalesce(cellulare, p_cellulare),
		cellulare_norm = coalesce(cellulare_norm, v_norm),
		fonte = coalesce(fonte, p_fonte),
		storico = case when p_fonte = 'migrazione' then storico else false end,
		aggiornato_il = now()
	where id = v_id;

	return v_id;
end;
$$;

revoke all on function public.trova_o_crea_persona(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.trova_o_crea_persona(text, text, text, text, text) to service_role;

/**
 * Aggancia ogni nuova richiesta alla sua persona.
 *
 * L'eccezione è catturata di proposito: se la deduplicazione fallisce — un
 * conflitto sugli indici univoci, per esempio un'email che punta a una
 * persona e un telefono che punta a un'altra — la richiesta deve entrare
 * comunque, con persona_id nullo. Un lead perso è un danno vero; un
 * collegamento di anagrafica mancante si sistema dopo.
 *
 * ATTENZIONE: questa è la versione di questo passo. 2026-09-02-opportunita.sql
 * la sostituisce con quella in produzione, che aggancia anche la trattativa.
 * Ricostruendo lo schema da zero i file vanno eseguiti in ordine, e l'ultima
 * parola è quella dell'altro file.
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
	exception when others then
		raise warning 'Deduplicazione persona non riuscita: %', sqlerrm;
		new.persona_id := null;
	end;
	return new;
end;
$$;

drop trigger if exists form_contatti_collega_persona on public.form_contatti;
create trigger form_contatti_collega_persona
	before insert on public.form_contatti
	for each row
	execute function public.collega_persona_a_contatto();

-- ──────────────────────────────────────────────────────────── backfill

-- Le richieste già in tabella, dalla più vecchia: l'ordine conta, perché la
-- prima a creare la persona è quella che le dà nome e cognome.
do $$
declare
	r record;
begin
	for r in select id, nome, cognome, email, cellulare from form_contatti
		where persona_id is null order by created_at loop
		begin
			update form_contatti
			set persona_id = trova_o_crea_persona(r.nome, r.cognome, r.email, r.cellulare)
			where id = r.id;
		exception when others then
			raise warning 'Backfill non riuscito per %: %', r.id, sqlerrm;
		end;
	end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────── vista

-- Una riga per persona con i suoi numeri: quante richieste, la prima e
-- l'ultima, quante ancora da lavorare. È quello che serve all'elenco della
-- sezione Persone, senza una query per riga.
create or replace view public.persone_con_richieste as
select
	p.id,
	p.creato_il,
	p.aggiornato_il,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	p.note,
	count(f.id) as richieste,
	count(f.id) filter (where not f.gestito) as richieste_da_lavorare,
	min(f.created_at) as prima_richiesta,
	max(f.created_at) as ultima_richiesta
from public.persone p
left join public.form_contatti f on f.persona_id = p.id
group by p.id;

alter view public.persone_con_richieste set (security_invoker = on);
revoke all on public.persone_con_richieste from anon, authenticated;
grant select on public.persone_con_richieste to service_role;
