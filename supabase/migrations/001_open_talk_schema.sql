-- Open Talk v2 schema: profiles, matching queue, calls, blocks, reports + RPCs.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  country text not null default '',
  level text not null default 'beginner' check (level in ('beginner','intermediate','advanced')),
  total_seconds integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.waiting_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  channel text not null unique,
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  rating_a smallint check (rating_a between 1 and 5),
  rating_b smallint check (rating_b between 1 and 5)
);
create index calls_user_a_idx on public.calls(user_a, created_at desc);
create index calls_user_b_idx on public.calls(user_b, created_at desc);
create table public.blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references auth.users(id) on delete cascade,
  reported uuid not null references auth.users(id) on delete cascade,
  call_id uuid references public.calls(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.waiting_queue enable row level security;
alter table public.calls enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy calls_read on public.calls for select to authenticated using (auth.uid() in (user_a, user_b));
create policy blocks_read on public.blocks for select to authenticated using (blocker = auth.uid());

-- Find a partner: returns an existing fresh match, creates a new one, or queues the caller.
create or replace function public.find_match()
returns table(call_id uuid, channel text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other uuid;
  c record;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into c from calls
   where status = 'active' and me in (user_a, user_b) and created_at > now() - interval '25 seconds'
   order by created_at desc limit 1;
  if found then
    delete from waiting_queue where user_id = me;
    return query select c.id, c.channel, case when c.user_a = me then c.user_b else c.user_a end;
    return;
  end if;

  delete from waiting_queue where last_seen < now() - interval '20 seconds';

  select q.user_id into other from waiting_queue q
   where q.user_id <> me
     and not exists (select 1 from blocks b
                      where (b.blocker = me and b.blocked = q.user_id)
                         or (b.blocker = q.user_id and b.blocked = me))
   order by q.joined_at
   limit 1
   for update skip locked;

  if other is not null then
    delete from waiting_queue where user_id in (me, other);
    insert into calls(channel, user_a, user_b)
      values ('ot_' || replace(gen_random_uuid()::text, '-', ''), other, me)
      returning calls.id, calls.channel into call_id, channel;
    partner_id := other;
    return next;
    return;
  end if;

  insert into waiting_queue(user_id) values (me)
    on conflict (user_id) do update set last_seen = now();
  return;
end $$;

create or replace function public.leave_queue()
returns void language sql security definer set search_path = public as $$
  delete from waiting_queue where user_id = auth.uid();
$$;

create or replace function public.end_call(p_call_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; secs int;
begin
  select * into c from calls where id = p_call_id and auth.uid() in (user_a, user_b) for update;
  if not found or c.status = 'ended' then return; end if;
  secs := greatest(0, extract(epoch from (now() - c.created_at))::int);
  update calls set status = 'ended', ended_at = now() where id = p_call_id;
  update profiles set total_seconds = total_seconds + secs where id in (c.user_a, c.user_b);
end $$;

create or replace function public.rate_call(p_call_id uuid, p_rating int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update calls set rating_a = case when user_a = auth.uid() then p_rating else rating_a end,
                   rating_b = case when user_b = auth.uid() then p_rating else rating_b end
   where id = p_call_id and auth.uid() in (user_a, user_b);
end $$;

create or replace function public.block_user(p_target uuid)
returns void language sql security definer set search_path = public as $$
  insert into blocks(blocker, blocked) values (auth.uid(), p_target) on conflict do nothing;
$$;

create or replace function public.report_user(p_target uuid, p_call_id uuid, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into reports(reporter, reported, call_id, reason) values (auth.uid(), p_target, p_call_id, left(p_reason, 500));
$$;

create or replace function public.today_seconds()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - created_at)))::int, 0)
    from calls
   where auth.uid() in (user_a, user_b) and created_at >= date_trunc('day', now());
$$;

create or replace function public.delete_my_account()
returns void language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.find_match, public.leave_queue, public.end_call, public.rate_call, public.block_user, public.report_user, public.today_seconds, public.delete_my_account from public, anon;
grant execute on function public.find_match, public.leave_queue, public.end_call, public.rate_call, public.block_user, public.report_user, public.today_seconds, public.delete_my_account to authenticated;

alter publication supabase_realtime add table public.calls;
