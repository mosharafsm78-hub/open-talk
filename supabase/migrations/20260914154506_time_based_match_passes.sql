
create table if not exists public.match_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pass_type text not null check (pass_type in ('gender','country','level','smart','priority')),
  target_value text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists match_passes_user_active_idx on public.match_passes(user_id, pass_type, expires_at);
alter table public.match_passes enable row level security;
revoke all on table public.match_passes from anon, authenticated;
grant select on table public.match_passes to authenticated;
drop policy if exists "Users can view their own match passes" on public.match_passes;
create policy "Users can view their own match passes" on public.match_passes for select to authenticated using ((select auth.uid()) = user_id);

drop function if exists public.find_and_claim_match_v2(uuid,text,text,text,boolean,integer);

create or replace function public.find_and_claim_match_v2(
  p_user_id uuid,
  p_target_country text default '',
  p_target_level text default '',
  p_gender_preference text default 'any',
  p_priority boolean default false,
  p_coin_cost integer default 0
)
returns table(call_id uuid, partner_id uuid, new_balance integer, pass_expires_at timestamptz, pass_type text, coins_charged integer)
language plpgsql security definer set search_path = public
as $function$
declare
  v_partner uuid; v_call uuid; v_my_gender text; v_my_country text; v_my_level text;
  v_balance integer; v_filter_count integer; v_base_type text := ''; v_base_target text := '';
  v_base_cost integer := 0; v_base_hours integer := 0; v_base_active boolean := false;
  v_priority_active boolean := false; v_charged integer := 0;
  v_pass_expires timestamptz := null; v_priority_expires timestamptz := null;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'not authorized'; end if;

  select coalesce(gender,''),coalesce(country,''),coalesce(english_level,'')
    into v_my_gender,v_my_country,v_my_level
  from public.profiles where id=p_user_id;

  v_filter_count :=
    (case when coalesce(p_gender_preference,'any') <> 'any' then 1 else 0 end) +
    (case when coalesce(p_target_country,'') <> '' then 1 else 0 end) +
    (case when coalesce(p_target_level,'') <> '' then 1 else 0 end);

  if v_filter_count >= 2 then
    v_base_type := 'smart';
    v_base_target := lower(coalesce(p_gender_preference,'any'))||'|'||lower(coalesce(p_target_country,''))||'|'||lower(coalesce(p_target_level,''));
    v_base_cost := 8; v_base_hours := 24;
  elsif v_filter_count = 1 then
    if coalesce(p_gender_preference,'any') <> 'any' then
      v_base_type := 'gender'; v_base_target := lower(p_gender_preference); v_base_cost := 4; v_base_hours := 12;
    elsif coalesce(p_target_country,'') <> '' then
      v_base_type := 'country'; v_base_target := lower(p_target_country); v_base_cost := 5; v_base_hours := 12;
    else
      v_base_type := 'level'; v_base_target := lower(p_target_level); v_base_cost := 4; v_base_hours := 12;
    end if;
  end if;

  if v_base_type <> '' then
    select exists(select 1 from public.match_passes where user_id=p_user_id and pass_type=v_base_type and target_value=v_base_target and expires_at>now()) into v_base_active;
    if v_base_active then
      select max(expires_at) into v_pass_expires from public.match_passes where user_id=p_user_id and pass_type=v_base_type and target_value=v_base_target and expires_at>now();
    end if;
  end if;

  if p_priority then
    select exists(select 1 from public.match_passes where user_id=p_user_id and pass_type='priority' and target_value='priority' and expires_at>now()) into v_priority_active;
    if v_priority_active then
      select max(expires_at) into v_priority_expires from public.match_passes where user_id=p_user_id and pass_type='priority' and target_value='priority' and expires_at>now();
    end if;
  end if;

  select c.id,case when c.caller_id=p_user_id then c.receiver_id else c.caller_id end into v_call,v_partner
  from public.calls c where (c.caller_id=p_user_id or c.receiver_id=p_user_id) and c.status in('matched','active')
  order by c.created_at desc limit 1;
  if v_call is not null then
    return query select v_call,v_partner,public.available_coins(p_user_id),
      greatest(coalesce(v_pass_expires,'epoch'::timestamptz),coalesce(v_priority_expires,'epoch'::timestamptz)),null::text,0;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('open-talk-match-v2',0));

  select w.user_id into v_partner
  from public.waiting_users w join public.profiles p on p.id=w.user_id
  where w.user_id<>p_user_id
    and (coalesce(p_gender_preference,'any')='any' or lower(coalesce(p.gender,''))=lower(p_gender_preference))
    and (coalesce(w.gender_preference,'any')='any' or lower(coalesce(w.gender_preference,'any'))=lower(v_my_gender))
    and (coalesce(p_target_country,'')='' or lower(coalesce(p.country,''))=lower(p_target_country))
    and (coalesce(w.country,'')='' or lower(coalesce(w.country,''))=lower(v_my_country))
    and (coalesce(p_target_level,'')='' or lower(coalesce(p.english_level,''))=lower(p_target_level))
    and (coalesce(w.english_level,'')='' or lower(coalesce(w.english_level,''))=lower(v_my_level))
  order by w.priority desc,
    case when coalesce(p_target_level,'')<>'' and lower(coalesce(p.english_level,''))=lower(p_target_level) then 0 else 1 end,
    case when coalesce(p_target_country,'')<>'' and lower(coalesce(p.country,''))=lower(p_target_country) then 0 else 1 end,
    w.joined_at asc
  for update of w skip locked limit 1;

  if v_partner is null then
    insert into public.waiting_users(user_id,country,english_level,gender_preference,priority)
    values(p_user_id,coalesce(p_target_country,''),coalesce(p_target_level,''),coalesce(p_gender_preference,'any'),p_priority)
    on conflict(user_id) do update set country=excluded.country,english_level=excluded.english_level,gender_preference=excluded.gender_preference,priority=excluded.priority,joined_at=now();
    return query select null::uuid,null::uuid,public.available_coins(p_user_id),
      greatest(coalesce(v_pass_expires,'epoch'::timestamptz),coalesce(v_priority_expires,'epoch'::timestamptz)),
      case when v_base_type<>'' then v_base_type when p_priority then 'priority' else null end,0;
    return;
  end if;

  if v_base_type<>'' and not v_base_active then v_charged:=v_charged+v_base_cost; end if;
  if p_priority and not v_priority_active then v_charged:=v_charged+3; end if;

  if v_charged>0 then
    v_balance:=public.spend_coins(p_user_id,v_charged,'match_pass',jsonb_build_object(
      'gender',p_gender_preference,'country',p_target_country,'level',p_target_level,'priority',p_priority,
      'hours',case when v_base_type='smart' then 24 else 12 end
    ));
  else
    v_balance:=public.available_coins(p_user_id);
  end if;

  if v_base_type<>'' and not v_base_active then
    v_pass_expires:=now() + make_interval(hours => v_base_hours);
    insert into public.match_passes(user_id,pass_type,target_value,expires_at) values(p_user_id,v_base_type,v_base_target,v_pass_expires);
  end if;
  if p_priority and not v_priority_active then
    v_priority_expires:=now() + interval '12 hours';
    insert into public.match_passes(user_id,pass_type,target_value,expires_at) values(p_user_id,'priority','priority',v_priority_expires);
  end if;

  delete from public.waiting_users where user_id in(p_user_id,v_partner);
  insert into public.calls(caller_id,receiver_id,status) values(p_user_id,v_partner,'matched') returning id into v_call;

  return query select v_call,v_partner,v_balance,
    greatest(coalesce(v_pass_expires,'epoch'::timestamptz),coalesce(v_priority_expires,'epoch'::timestamptz)),
    case when v_base_type<>'' then v_base_type when p_priority then 'priority' else null end,v_charged;
end;
$function$;

grant execute on function public.find_and_claim_match_v2(uuid,text,text,text,boolean,integer) to authenticated;
;
