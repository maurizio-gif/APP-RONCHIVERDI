-- La trattativa annullata: né vinta né persa, non è mai esistita.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-10-esito-firmato.sql.
--
-- ATTENZIONE, a differenza delle ultime due migration questa NON è
-- facoltativa e va eseguita PRIMA del deploy: il vincolo qui sotto è quello
-- che permette di scrivere 'annullato' in `stato`, e senza il pannello
-- risponderebbe con un errore del database a ogni annullamento.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- Una trattativa può nascere per sbaglio: un doppione, una riga finita sulla
-- persona sbagliata, una prova rimasta in giro.
--
-- Da non confondere con le trattative che nascono da sole ed è GIUSTO che
-- nascano: se al banco si spunta un interesse per il Club o per il Family, o
-- se un commerciale mette un evento in agenda, la trattativa deve esserci —
-- è il modello, non un incidente. Quelle non si annullano: si lavorano.
--
-- Per gli sbagli veri, invece, finora l'unica uscita era «Persa». Ma persa
-- vuol dire una cosa precisa — ci abbiamo provato e non è andata — e usarla
-- per una riga nata per errore costa tre bugie: il riquadro «Perse da te» in
-- dashboard conta una sconfitta che non c'è stata, `motivo_perso` chiede il
-- perché di una trattativa che non è mai stata una trattativa, e nella scheda
-- della persona resta scritto che con lei è andata male.
--
-- Da qui il quinto stato. È finale come vinto e perso — valorizza chiuso_il,
-- esce dagli elenchi del lavoro da fare, non blocca la prossima richiesta —
-- ma non è un esito: è il modo di dire «questa riga non andava creata».

-- ────────────────────────────────────────────── 1. il vincolo sugli stati

-- Il vecchio vincolo era scritto dentro il create table, quindi il suo nome
-- l'ha deciso PostgreSQL. Cercarlo per contenuto e non per nome atteso non è
-- pedanteria: se il nome non fosse quello, un `drop constraint if exists`
-- non troverebbe niente in silenzio, l'`add` qui sotto riuscirebbe lo stesso,
-- e il vincolo vecchio resterebbe lì a rifiutare 'annullato'. Un fallimento
-- che non si vede finché qualcuno non prova ad annullare una trattativa.
do $$
declare
	r record;
begin
	for r in
		select conname
		from pg_constraint
		where conrelid = 'public.opportunita'::regclass
			and contype = 'c'
			and pg_get_constraintdef(oid) ilike '%in_gestione%'
	loop
		execute format('alter table public.opportunita drop constraint %I', r.conname);
	end loop;
end;
$$;

alter table public.opportunita
	add constraint opportunita_stato_check
	check (stato in ('nuovo', 'in_gestione', 'vinto', 'perso', 'annullato'));

comment on column public.opportunita.stato is
	'Dov''è la trattativa: nuovo (nessuno la segue) | in_gestione | vinto | perso | annullato. I primi due sono aperti; gli altri tre sono finali e valorizzano chiuso_il. ''annullato'' è finale ma NON è un esito: dice che la trattativa non andava creata (un doppione, una riga finita sulla persona sbagliata, una prova), e per questo non entra nei conti di vinte e perse. Non si usa per le trattative nate da sole dal banco o da un evento di agenda: quelle sono volute e si lavorano.';

-- ────────────────────────────────────────────────── 2. il perché si annulla

-- Una colonna sua e non `motivo_perso`: sono due domande diverse. «Perché è
-- andata persa» è un fatto commerciale che si rilegge per imparare qualcosa;
-- «perché è stata annullata» è la spiegazione di un errore di inserimento.
-- Scriverli nella stessa colonna vorrebbe dire non poter più leggere i motivi
-- di perdita senza prima filtrare via gli sbagli.
alter table public.opportunita
	add column if not exists motivo_annullato text;

comment on column public.opportunita.motivo_annullato is
	'Compilato solo quando lo stato è ''annullato'': perché questa trattativa non andava creata (doppione, persona sbagliata, prova). Distinto da motivo_perso, che è il motivo commerciale di una trattativa vera andata male.';

comment on column public.opportunita.motivo_perso is
	'Compilato solo quando lo stato è ''perso'': il motivo commerciale per cui non è andata. Per una trattativa nata per errore non si usa questo campo ma motivo_annullato, con lo stato ''annullato''.';

-- ──────────────────────────────────── 3. l'indice delle trattative aperte

-- L'indice parziale serve alla domanda «cosa resta da lavorare»: una
-- annullata non resta da lavorare, e lasciarla dentro la farebbe pesare su
-- ogni lettura senza che nessuno la voglia mai leggere.
drop index if exists public.opportunita_aperte_idx;
create index if not exists opportunita_aperte_idx on public.opportunita (stato)
	where stato not in ('vinto', 'perso', 'annullato');

-- ─────────────────────────── 4. una annullata non è la trattativa aperta

/**
 * La trattativa aperta di una persona, o una nuova.
 *
 * Identica alla versione di 2026-09-02-opportunita.sql tranne che per il
 * trattamento di 'annullato', e sono due punti, non uno:
 *
 *   1. una annullata NON si riusa. È il punto di tutta questa migration: se
 *      restasse «l'aperta», la prossima richiesta di quella persona ci si
 *      aggancerebbe e l'errore tornerebbe indietro da solo — annullare non
 *      avrebbe annullato niente.
 *
 *   2. una annullata NON detta l'assegnatario da ereditare. La nuova
 *      trattativa eredita chi seguiva la persona l'ultima volta, ma su una
 *      riga nata per sbaglio non la seguiva nessuno: prendere quel valore
 *      (di solito nullo) vorrebbe dire perdere il commerciale vero che
 *      c'era prima dell'errore.
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
	where persona_id = p_persona_id and stato not in ('vinto', 'perso', 'annullato')
	order by creato_il desc
	limit 1;

	if v_id is not null then return v_id; end if;

	select assegnato_a into v_ultimo_assegnatario
	from opportunita
	where persona_id = p_persona_id and stato <> 'annullato'
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

-- ────────────────────────────────────────────────────────── 5. la vista

-- `trattative` porta motivo_perso: senza il nuovo campo, chi legge da lì una
-- annullata la vedrebbe senza spiegazione.
--
-- `create or replace` e non `drop` + `create`: un drop fallisce se qualcosa
-- dipende dalla vista, e in mezzo a una migration eseguita a mano un
-- fallimento lascia il database a metà. Il prezzo è che la colonna nuova va
-- IN FONDO — è l'unico posto in cui replace permette di aggiungerne una — e
-- quindi non sta accanto a motivo_perso come si vorrebbe: la vista si legge
-- per nome di colonna, non per posizione, e non vale un drop per l'ordine.
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
	max(f.created_at) as ultima_richiesta,
	o.motivo_annullato
from public.opportunita o
	join public.persone p on p.id = o.persona_id
	left join public.form_contatti f on f.opportunita_id = o.id
group by o.id, p.id;

alter view public.trattative set (security_invoker = on);
revoke all on public.trattative from anon, authenticated;
grant select on public.trattative to service_role;

-- ──────────────────────────────────────────────────────── da rileggere dopo

-- Quante trattative per stato, e quante perse senza motivo registrato. La
-- seconda colonna è quella da guardare fra un mese: se le «perse senza
-- motivo» calano mentre compaiono le annullate, vuol dire che gli errori di
-- inserimento stavano davvero finendo fra le sconfitte.
select
	stato,
	count(*) as quante,
	count(*) filter (where stato = 'perso' and motivo_perso is null) as perse_senza_motivo,
	count(*) filter (where stato = 'annullato' and motivo_annullato is null) as annullate_senza_motivo
from public.opportunita
group by stato
order by 2 desc;

-- Le persone che hanno una trattativa annullata e nessun'altra: sono quelle
-- entrate in pipeline solo per errore. Da rileggere ogni tanto per capire da
-- dove arrivano gli sbagli e toglierli alla fonte.
select p.id, p.nome, p.cognome, o.motivo_annullato, o.chiuso_il
from public.opportunita o
	join public.persone p on p.id = o.persona_id
where o.stato = 'annullato'
	and not exists (
		select 1 from public.opportunita a
		where a.persona_id = o.persona_id and a.stato <> 'annullato'
	)
order by o.chiuso_il desc nulls last;
