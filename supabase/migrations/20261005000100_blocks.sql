-- Blocks: reproducible definition. The live table already exists (see
-- supabase/production.sql); every statement here is idempotent and nothing
-- existing is dropped or altered. The live column is blocked_user_id.

create table if not exists public.blocks(
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_user_id)
);

create index if not exists blocks_blocker_idx on public.blocks(blocker_id);
create index if not exists blocks_blocked_idx on public.blocks(blocked_user_id);

alter table public.blocks enable row level security;

-- Users read/insert only their own rows. The existing "blocks_self" policy
-- (FOR ALL) already covers this and also allows unblocking; it is left alone.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='blocks') then
    create policy blocks_self on public.blocks
      for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);
  end if;
end $$;

-- Block a user and end any live call between the two, atomically.
-- SECURITY DEFINER so the call row can be cancelled regardless of calls RLS;
-- the caller identity is always auth.uid(), never a parameter.
create or replace function public.block_user(p_blocked_user_id uuid)
returns table(blocked boolean, calls_ended integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ended integer;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_blocked_user_id is null or p_blocked_user_id = auth.uid() then
    raise exception 'invalid blocked user';
  end if;

  insert into public.blocks(blocker_id, blocked_user_id)
  values (auth.uid(), p_blocked_user_id)
  on conflict (blocker_id, blocked_user_id) do nothing;

  update public.calls
  set status = 'cancelled', ended_at = now()
  where status in ('matched', 'active')
    and ((caller_id = auth.uid() and receiver_id = p_blocked_user_id)
      or (caller_id = p_blocked_user_id and receiver_id = auth.uid()));
  get diagnostics v_ended = row_count;

  return query select true, v_ended;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
