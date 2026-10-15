-- La Dashboard New anche a chi coordina i commerciali senza esserlo: la legge,
-- ma non compare fra gli assegnatari e non prende in carico (vedi
-- vedeDashboardNew in lib/auth/permessi.ts). Applicato il 15/10/2026.
alter table public.staff_users add column if not exists vede_dashboard_new boolean not null default false;
comment on column public.staff_users.vede_dashboard_new is 'Vede la Dashboard New anche senza essere commerciale (chi coordina: legge, non viene proposto come assegnatario).';

update public.staff_users set vede_dashboard_new = true
where lower(email) in ('maurizio@ready2digital.it', 'l.gravante@ronchiverdi.it', 's.aggazio@ronchiverdi.it');
