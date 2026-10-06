
create or replace function public.find_and_claim_match(
  p_user_id uuid,
  p_country text,
  p_english_level text,
  p_gender_preference text
)
returns table(call_id uuid, partner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
  v_call uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;

  select c.id, case when c.caller_id=p_user_id then c.receiver_id else c.caller_id end
  into v_call, v_partner
  from public.calls c
  where (c.caller_id=p_user_id or c.receiver_id=p_user_id)
    and c.status in ('matched','active')
  order by c.created_at desc
  limit 1;

  if v_call is not null then
    return query select v_call,v_partner;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('open-talk-match', 0));

  select w.user_id into v_partner
  from public.waiting_users w
  join public.profiles p on p.id=w.user_id
  where w.user_id<>p_user_id
    and (p_gender_preference='any' or w.gender_preference=p_gender_preference or p.gender_preference='any')
    and (p_country is null or p_country='' or w.country is null or w.country='' or w.country=p_country)
  order by case when p_english_level is not null and p_english_level<>'' and w.english_level=p_english_level then 0 else 1 end, w.joined_at asc
  for update of w skip locked limit 1;

  if v_partner is null then
    insert into public.waiting_users(user_id,country,english_level,gender_preference)
    values(p_user_id,p_country,p_english_level,coalesce(p_gender_preference,'any'))
    on conflict(user_id) do update set country=excluded.country,english_level=excluded.english_level,gender_preference=excluded.gender_preference,joined_at=now();
    return;
  end if;

  delete from public.waiting_users where user_id in(p_user_id,v_partner);
  insert into public.calls(caller_id,receiver_id,status) values(p_user_id,v_partner,'matched') returning id into v_call;
  return query select v_call,v_partner;
end;
$$;
revoke all on function public.find_and_claim_match(uuid,text,text,text) from public;
grant execute on function public.find_and_claim_match(uuid,text,text,text) to authenticated;
;
