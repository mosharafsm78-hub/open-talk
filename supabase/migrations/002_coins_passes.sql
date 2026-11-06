-- Open Talk: coins, daily reward, achievements, match passes (gender / country filters).

alter table public.profiles
  add column gender text check (gender in ('male','female')),
  add column coins integer not null default 0 check (coins >= 0),
  add column streak integer not null default 0,
  add column last_daily date,
  add column gender_until timestamptz,
  add column country_until timestamptz;

-- Users may edit only their own identity fields; coins, passes and stats are server-controlled.
revoke insert, update on public.profiles from authenticated, anon;
grant insert (id, display_name, country, level, gender) on public.profiles to authenticated;
grant update (display_name, country, level, gender) on public.profiles to authenticated;

alter table public.waiting_queue
  add column gender text,
  add column country text,
  add column want_gender text,
  add column want_country text;

create table public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index coin_ledger_user_idx on public.coin_ledger(user_id, created_at desc);
alter table public.coin_ledger enable row level security;
create policy ledger_read on public.coin_ledger for select to authenticated using (user_id = auth.uid());
revoke all on public.coin_ledger from anon, authenticated;
grant select on public.coin_ledger to authenticated;

create table public.achievement_defs (
  key text primary key,
  title text not null,
  description text not null,
  kind text not null check (kind in ('calls','minutes')),
  target integer not null,
  reward integer not null,
  sort integer not null
);
alter table public.achievement_defs enable row level security;
create policy defs_read on public.achievement_defs for select to authenticated using (true);
revoke all on public.achievement_defs from anon, authenticated;
grant select on public.achievement_defs to authenticated;

insert into public.achievement_defs(key, title, description, kind, target, reward, sort) values
  ('calls_5',  'Getting started', 'Finish 5 conversations',  'calls',   5,   20, 1),
  ('calls_10', 'Regular talker',  'Finish 10 conversations', 'calls',   10,  40, 2),
  ('calls_30', 'Conversation pro','Finish 30 conversations', 'calls',   30, 120, 3),
  ('mins_30',  'Warming up',      'Speak for 30 minutes',    'minutes', 30,  50, 4),
  ('mins_60',  'One hour club',   'Speak for 1 hour',        'minutes', 60, 100, 5),
  ('mins_300', 'Fluency builder', 'Speak for 5 hours',       'minutes', 300,400, 6);

create table public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null references public.achievement_defs(key),
  claimed_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_achievements enable row level security;
create policy ua_read on public.user_achievements for select to authenticated using (user_id = auth.uid());
revoke all on public.user_achievements from anon, authenticated;
grant select on public.user_achievements to authenticated;

-- A conversation counts once it lasted at least a minute (prevents quick-hangup farming).
create or replace function public.qualified_calls(uid uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from calls
   where status = 'ended' and uid in (user_a, user_b)
     and ended_at - created_at >= interval '60 seconds';
$$;

create or replace function public.get_wallet()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'coins', p.coins,
    'streak', p.streak,
    'daily_available', p.last_daily is distinct from current_date,
    'gender_until', p.gender_until,
    'country_until', p.country_until,
    'calls', public.qualified_calls(p.id),
    'minutes', p.total_seconds / 60
  ) from profiles p where p.id = auth.uid();
$$;

create or replace function public.claim_daily()
returns integer language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p record; new_streak int; reward int;
begin
  select * into p from profiles where id = me for update;
  if not found then raise exception 'no_profile'; end if;
  if p.last_daily = current_date then raise exception 'already_claimed'; end if;
  new_streak := case when p.last_daily = current_date - 1 then p.streak + 1 else 1 end;
  reward := 5 + case when new_streak % 7 = 0 then 20 else 0 end;
  update profiles set coins = coins + reward, streak = new_streak, last_daily = current_date where id = me;
  insert into coin_ledger(user_id, amount, reason) values (me, reward, 'daily_reward');
  return reward;
end $$;

create or replace function public.list_achievements()
returns table(ach_key text, title text, description text, reward integer, progress integer, target integer, claimed boolean)
language sql stable security definer set search_path = public as $$
  select d.key, d.title, d.description, d.reward,
         least(case d.kind when 'calls' then public.qualified_calls(auth.uid())
                           else (select total_seconds / 60 from profiles where id = auth.uid()) end, d.target)::int,
         d.target,
         exists (select 1 from user_achievements u where u.user_id = auth.uid() and u.key = d.key)
    from achievement_defs d order by d.sort;
$$;

create or replace function public.claim_achievement(p_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d record; have int; n int;
begin
  select * into d from achievement_defs where key = p_key;
  if not found then raise exception 'unknown_achievement'; end if;
  if d.kind = 'calls' then have := public.qualified_calls(me);
  else select total_seconds / 60 into have from profiles where id = me; end if;
  if coalesce(have, 0) < d.target then raise exception 'not_ready'; end if;
  insert into user_achievements(user_id, key) values (me, p_key) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'already_claimed'; end if;
  update profiles set coins = coins + d.reward where id = me;
  insert into coin_ledger(user_id, amount, reason) values (me, d.reward, 'achievement:' || p_key);
  return d.reward;
end $$;

-- Spend coins on a match pass. Kinds/options: gender 1h/1d, country 1d/2d. Extends an active pass.
create or replace function public.buy_pass(p_kind text, p_option text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); price int; dur interval; p record; result timestamptz;
begin
  if p_kind = 'gender' and p_option = '1h' then price := 40;  dur := interval '1 hour';
  elsif p_kind = 'gender' and p_option = '1d' then price := 200; dur := interval '1 day';
  elsif p_kind = 'country' and p_option = '1d' then price := 150; dur := interval '1 day';
  elsif p_kind = 'country' and p_option = '2d' then price := 250; dur := interval '2 days';
  else raise exception 'unknown_pass'; end if;
  select * into p from profiles where id = me for update;
  if not found then raise exception 'no_profile'; end if;
  if p.coins < price then raise exception 'not_enough_coins'; end if;
  if p_kind = 'gender' then
    result := greatest(coalesce(p.gender_until, now()), now()) + dur;
    update profiles set coins = coins - price, gender_until = result where id = me;
  else
    result := greatest(coalesce(p.country_until, now()), now()) + dur;
    update profiles set coins = coins - price, country_until = result where id = me;
  end if;
  insert into coin_ledger(user_id, amount, reason) values (me, -price, 'pass:' || p_kind || '_' || p_option);
  return result;
end $$;

-- Matching now honours active passes (checked on the server, never trusted from the app).
drop function public.find_match();
create or replace function public.find_match(p_gender text default null, p_country text default null)
returns table(call_id uuid, channel text, partner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mp record;
  other uuid;
  c record;
  w_gender text;
  w_country text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into mp from profiles where id = me;
  if not found then raise exception 'no_profile'; end if;

  w_gender := case when p_gender in ('male','female') and mp.gender_until > now() then p_gender end;
  w_country := case when coalesce(p_country, '') <> '' and mp.country_until > now() then p_country end;

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
     and (w_gender is null or q.gender = w_gender)
     and (w_country is null or q.country = w_country)
     and (q.want_gender is null or q.want_gender = mp.gender)
     and (q.want_country is null or q.want_country = mp.country)
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

  insert into waiting_queue(user_id, gender, country, want_gender, want_country)
    values (me, mp.gender, mp.country, w_gender, w_country)
    on conflict (user_id) do update
      set last_seen = now(), gender = excluded.gender, country = excluded.country,
          want_gender = excluded.want_gender, want_country = excluded.want_country;
  return;
end $$;

revoke all on function public.qualified_calls(uuid) from public, anon, authenticated;
revoke all on function public.get_wallet, public.claim_daily, public.list_achievements,
  public.claim_achievement, public.buy_pass, public.find_match(text, text) from public, anon;
grant execute on function public.get_wallet, public.claim_daily, public.list_achievements,
  public.claim_achievement, public.buy_pass, public.find_match(text, text) to authenticated;
