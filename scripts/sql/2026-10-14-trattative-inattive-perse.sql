-- Trattative in gestione ferme da 14 giorni: si chiudono come perse.
--
-- La regola, decisa il 14 ottobre 2026: una trattativa `in_gestione` è persa
-- se **nessuna interazione negli ultimi 14 giorni** e **niente in agenda per
-- il futuro**. Senza, la Dashboard New si riempiva di lead che nessuno
-- seguiva più (58 su 108 al primo giro), e i numeri «in gestione» di ogni
-- commerciale contavano anche quelli.
--
-- Cosa vale come interazione — la più recente fra:
--
--  - le voci d'agenda chiuse (telefonate, email, WhatsApp, appuntamenti,
--    task), quelle sulla persona e quelle sulle sue richieste dal sito: conta
--    quando sono state chiuse (esito_il, o completato_il per le più vecchie);
--  - le richieste arrivate dal sito, e quando sono state lavorate;
--  - la nascita della trattativa, la presa in carico e l'ultimo cambio di
--    stato: un lead appena arrivato, o appena passato a un collega, non deve
--    risultare fermo da settimane solo perché la persona è vecchia.
--
-- Cosa vale come impegno futuro: una voce d'agenda ancora aperta con data da
-- oggi in poi (oggi a Roma). Una voce aperta con la data passata non conta:
-- è un arretrato, non un impegno — e alla chiusura della trattativa viene
-- annullata (non cancellata), così non resta fra gli arretrati del
-- commerciale una telefonata per un lead che non c'è più.
--
-- La chiusura è come quella fatta a mano da «Segna persa» (cambiaStato in
-- app/dashboard/richieste/trattativa-actions.ts): stato, chiuso_il, il motivo
-- nella sua colonna e gli altri azzerati. stato_da = 'regola-14-giorni', come
-- 'sync-info4u' per le vinte chiuse da una vendita: dice che non l'ha chiusa
-- una persona. Ogni chiusura scrive una riga in audit_log, visibile in
-- Controllo operatori. Si riapre a mano come qualunque persa.
--
-- La chiama ogni giorno /api/cron/trattative-inattive (vedi vercel.json).

create or replace function public.chiudi_trattative_inattive(p_giorni integer default 14)
returns table (
	opportunita_id uuid,
	persona_id uuid,
	assegnato_a text,
	ultima_interazione timestamptz,
	voci_annullate integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
-- Le colonne del risultato (persona_id, assegnato_a...) hanno lo stesso nome
-- di colonne vere: dentro le query vince la colonna.
#variable_conflict use_column
declare
	v_oggi date := (now() at time zone 'Europe/Rome')::date;
	v_soglia timestamptz := now() - make_interval(days => greatest(p_giorni, 1));
	v_motivo text := format(
		'Chiusa in automatico: nessuna interazione da %s giorni e nessun impegno in agenda.',
		greatest(p_giorni, 1)
	);
	r record;
	v_annullate integer;
begin
	for r in
		with voci as (
			-- Le voci d'agenda di ogni persona: quelle agganciate a lei e quelle
			-- agganciate a una sua richiesta dal sito.
			select
				t.id, t.stato, t.data, t.esito_il, t.completato_il,
				coalesce(
					case when t.entita = 'persona' then t.entita_id::uuid end,
					fc.persona_id
				) as persona_id
			from task t
			left join form_contatti fc
				on t.entita = 'form_contatti' and fc.id::text = t.entita_id
		),
		calcolo as (
			select
				o.id,
				o.persona_id,
				o.assegnato_a,
				greatest(
					o.creato_il, o.assegnato_il, o.stato_il,
					(select max(coalesce(v.esito_il, v.completato_il))
						from voci v where v.persona_id = o.persona_id and v.stato = 'completato'),
					(select max(greatest(f.created_at, f.gestito_il))
						from form_contatti f where f.persona_id = o.persona_id)
				) as ultima,
				exists (
					select 1 from voci v
					where v.persona_id = o.persona_id and v.stato = 'aperto' and v.data >= v_oggi
				) as futuro
			from opportunita o
			where o.stato = 'in_gestione'
		)
		select c.id, c.persona_id, c.assegnato_a, c.ultima
		from calcolo c
		where c.ultima < v_soglia and not c.futuro
	loop
		update opportunita o
		set
			stato = 'perso',
			stato_da = 'regola-14-giorni',
			stato_il = now(),
			chiuso_il = now(),
			motivo_perso = v_motivo,
			motivo_vinto = null,
			motivo_annullato = null,
			valore_euro = null,
			triple_pack = false
		-- Ricontrollato qui: fra il calcolo e l'update qualcuno potrebbe averla
		-- appena chiusa o vinta a mano.
		where o.id = r.id and o.stato = 'in_gestione';

		if not found then continue; end if;

		-- Gli arretrati di quella persona: voci aperte con la data passata.
		with da_annullare as (
			select t.id
			from task t
			left join form_contatti fc
				on t.entita = 'form_contatti' and fc.id::text = t.entita_id
			where t.stato = 'aperto'
				and t.data < v_oggi
				and coalesce(case when t.entita = 'persona' then t.entita_id::uuid end, fc.persona_id) = r.persona_id
		)
		update task t set stato = 'annullato'
		from da_annullare d
		where t.id = d.id;
		get diagnostics v_annullate = row_count;

		insert into audit_log (email, azione, entita, entita_id, dettagli)
		values (
			'regola-14-giorni',
			'trattativa_persa_inattiva',
			'opportunita',
			r.id::text,
			jsonb_build_object(
				'da', 'in_gestione',
				'a', 'perso',
				'motivo', v_motivo,
				'assegnato_a', r.assegnato_a,
				'ultima_interazione', r.ultima,
				'voci_annullate', v_annullate
			)
		);

		opportunita_id := r.id;
		persona_id := r.persona_id;
		assegnato_a := r.assegnato_a;
		ultima_interazione := r.ultima;
		voci_annullate := v_annullate;
		return next;
	end loop;
end;
$$;

-- La chiama solo il server (il cron) con la service role.
revoke all on function public.chiudi_trattative_inattive(integer) from public, anon, authenticated;
grant execute on function public.chiudi_trattative_inattive(integer) to service_role;
