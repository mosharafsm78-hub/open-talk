alter table public.waiting_users add column if not exists priority boolean not null default false;
create index if not exists waiting_users_priority_joined_idx on public.waiting_users(priority desc,joined_at asc);

create or replace function public.find_and_claim_match_v2(
  p_user_id uuid,
  p_target_country text default '',
  p_target_level text default '',
  p_gender_preference text default 'any',
  p_priority boolean default false,
  p_coin_cost integer default 0
)
returns table(call_id uuid,partner_id uuid,new_balance integer)
language plpgsql security definer set search_path=public as $$
declare
  v_partner uuid; v_call uuid; v_my_gender text; v_my_country text; v_my_level text; v_balance integer;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'not authorized'; end if;
  select coalesce(gender,''),coalesce(country,''),coalesce(english_level,'') into v_my_gender,v_my_country,v_my_level from public.profiles where id=p_user_id;

  select c.id,case when c.caller_id=p_user_id then c.receiver_id else c.caller_id end into v_call,v_partner
  from public.calls c where (c.caller_id=p_user_id or c.receiver_id=p_user_id) and c.status in('matched','active')
  order by c.created_at desc limit 1;
  if v_call is not null then return query select v_call,v_partner,public.available_coins(p_user_id); return; end if;

  if p_coin_cost>0 and public.available_coins(p_user_id)<p_coin_cost then raise exception 'Not enough coins. You need % coins for this match.',p_coin_cost; end if;

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
    return query select null::uuid,null::uuid,public.available_coins(p_user_id); return;
  end if;

  delete from public.waiting_users where user_id in(p_user_id,v_partner);

  if p_coin_cost>0 then
    v_balance:=public.spend_coins(p_user_id,p_coin_cost,'match_spend',jsonb_build_object('target_country',p_target_country,'target_level',p_target_level,'gender_preference',p_gender_preference,'priority',p_priority));
  else v_balance:=public.available_coins(p_user_id); end if;

  insert into public.calls(caller_id,receiver_id,status) values(p_user_id,v_partner,'matched') returning id into v_call;
  return query select v_call,v_partner,v_balance;
end;
$$;;
