begin;

create or replace function public.delete_video_render_job(p_job_id text)
returns public."VideoRenderJob"
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public."User";
  deleted_job public."VideoRenderJob";
begin
  select * into actor from public.current_app_user();
  if actor.id is null or actor.role::text not in ('ADMIN', 'ADMIN_MASTER') then
    raise exception 'Somente o administrador master pode excluir vídeos.';
  end if;

  delete from public."VideoRenderJob"
  where id = p_job_id
    and status in ('COMPLETED', 'FAILED', 'CANCELLED')
  returning * into deleted_job;

  if deleted_job.id is null then
    raise exception 'A renderização precisa estar concluída, cancelada ou com falha antes da exclusão.';
  end if;
  return deleted_job;
end;
$$;

revoke all on function public.delete_video_render_job(text) from public, anon;
grant execute on function public.delete_video_render_job(text) to authenticated;

drop policy if exists "video files master delete" on storage.objects;
create policy "video files master delete"
on storage.objects for delete to authenticated
using (bucket_id = 'marketing-videos' and public.is_admin_master());

commit;
