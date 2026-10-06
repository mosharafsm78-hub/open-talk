CREATE OR REPLACE FUNCTION public.find_and_claim_match_v2(p_user_id uuid, p_target_country text DEFAULT ''::text, p_target_level text DEFAULT ''::text, p_gender_preference text DEFAULT 'any'::text, p_priority boolean DEFAULT false, p_coin_cost integer DEFAULT 0)
 RETURNS TABLE(call_id uuid, partner_id uuid, new_balance integer, pass_expires_at timestamp with time zone, pass_type text, coins_charged integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner uuid;
  v_call uuid;
  v_my_gender text;
  v_my_country text;
  v_my_level text;
  v_balance integer;
  v_filter_count integer;
  v_base_type text:='';
  v_base_target text:='';
  v_base_cost integer:=0;
  v_base_hours integer:=0;
  v_base_active boolean:=false;
  v_priority_active boolean:=false;
  v_charged integer:=0;
  v_pass_expires timestamptz:=null;
  v_priority_expires timestamptz:=null;
begin
  -- Expire abandoned active calls so a crashed/background-suspended browser
  -- cannot permanently reserve a user. Two hours is long enough for normal
  -- practice sessions while preventing day-old stale matches.
  update public.calls
  set status='cancelled',ended_at=now()
  where status='active'
    and coalesce(started_at,created_at) < now()-interval '2 hours';

  select coalesce(gender,''),coalesce(country,''),coalesce(english_level,'')
    into v_my_gender,v_my_country,v_my_level
  from public.profiles where id=p_user_id;
  if not found then raise exception 'profile not found'; end if;

  v_filter_count :=
    (case when coalesce(p_gender_preference,'any') <> 'any' then 1 else 0 end)
    +(case when coalesce(p_target_country,'') <> '' then 1 else 0 end)
    +(case when coalesce(p_target_level,'') <> '' then 1 else 0 end);

  if v_filter_count>=2 then
    v_base_type:='smart';
    v_base_target:=lower(coalesce(p_gender_preference,'any'))||'|'||lower(coalesce(p_target_country,''))||'|'||lower(coalesce(p_target_level,''));
    v_base_cost:=8; v_base_hours:=24;
  elsif v_filter_count=1 then
    if coalesce(p_gender_preference,'any')<>'any' then
      v_base_type:='gender'; v_base_target:=lower(p_gender_preference); v_base_cost:=4; v_base_hours:=12;
    elsif coalesce(p_target_country,'')<>'' then
      v_base_type:='country'; v_base_target:=lower(p_target_country); v_base_cost:=5; v_base_hours:=12;
    else
      v_base_type:='level'; v_base_target:=lower(p_target_level); v_base_cost:=4; v_base_hours:=12;
    end if;
  end if;

  if v_base_type<>'' then
    select exists(
      select 1 from public.match_passes
      where user_id=p_user_id and pass_type=v_base_type and target_value=v_base_target and expires_at>now()
    ) into v_base_active;
    if v_base_active then
      select max(expires_at) into v_pass_expires
      from public.match_passes
      where user_id=p_user_id and pass_type=v_base_type and target_value=v_base_target and expires_at>now();
    end if;
  end if;

  if p_priority then
    select exists(
      select 1 from public.match_passes
      where user_id=p_user_id and pass_type='priority' and target_value='priority' and expires_at>now()
    ) into v_priority_active;
    if v_priority_active then
      select max(expires_at) into v_priority_expires
      from public.match_passes
      where user_id=p_user_id and pass_type='priority' and target_value='priority' and expires_at>now();
    end if;
  end if;

  -- A match is only a short-lived handshake state. If WebRTC has not become
  -- active quickly, release both users so they can be matched again.
  update public.calls
  set status='cancelled',ended_at=now()
  where status='matched'
    and created_at < now()-interval '90 seconds'
    and (caller_id=p_user_id or receiver_id=p_user_id);

  -- Never strand a user on an old matched call. Active calls are retained.
  select c.id,
         case when c.caller_id=p_user_id then c.receiver_id else c.caller_id end
    into v_call,v_partner
  from public.calls c
  where (c.caller_id=p_user_id or c.receiver_id=p_user_id)
    and (
      c.status='active'
      or (c.status='matched' and c.created_at >= now()-interval '90 seconds')
    )
  order by c.created_at desc
  limit 1;

  if v_call is not null then
    return query
    select v_call,v_partner,public.available_coins(p_user_id),
      greatest(coalesce(v_pass_expires,'epoch'::timestamptz),coalesce(v_priority_expires,'epoch'::timestamptz)),
      null::text,0;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('open-talk-match-v5',0));

  -- Remove abandoned queue entries quickly. A live client refreshes its row
  -- on every polling attempt, so a 90-second window is safe and responsive.
  delete from public.waiting_users where joined_at<now()-interval '90 seconds';

  update public.waiting_users
  set country=coalesce(v_my_country,''),
      english_level=coalesce(v_my_level,''),
      gender_preference=coalesce(p_gender_preference,'any'),
      target_country=coalesce(p_target_country,''),
      target_level=coalesce(p_target_level,''),
      priority=p_priority,
      joined_at=now()
  where user_id=p_user_id;

  select w.user_id into v_partner
  from public.waiting_users w
  join public.profiles p on p.id=w.user_id
  where w.user_id<>p_user_id
    and (coalesce(w.gender_preference,'any')='any' or lower(coalesce(v_my_gender,''))=lower(w.gender_preference))
    and (coalesce(p_gender_preference,'any')='any' or lower(coalesce(p.gender,''))=lower(p_gender_preference))
    and (coalesce(w.target_country,'')='' or lower(coalesce(v_my_country,''))=lower(w.target_country))
    and (coalesce(p_target_country,'')='' or lower(coalesce(p.country,''))=lower(p_target_country))
    and (coalesce(w.target_level,'')='' or lower(coalesce(v_my_level,''))=lower(w.target_level))
    and (coalesce(p_target_level,'')='' or lower(coalesce(p.english_level,''))=lower(p_target_level))
  order by w.priority desc,w.joined_at asc
  for update of w skip locked
  limit 1;

  if v_partner is null then
    insert into public.waiting_users(
      user_id,country,english_level,gender_preference,target_country,target_level,priority
    )
    values(
      p_user_id,coalesce(v_my_country,''),coalesce(v_my_level,''),
      coalesce(p_gender_preference,'any'),coalesce(p_target_country,''),
      coalesce(p_target_level,''),p_priority
    )
    on conflict(user_id) do update set
      country=excluded.country,
      english_level=excluded.english_level,
      gender_preference=excluded.gender_preference,
      target_country=excluded.target_country,
      target_level=excluded.target_level,
      priority=excluded.priority,
      joined_at=now();

    return query
    select null::uuid,null::uuid,public.available_coins(p_user_id),
      greatest(coalesce(v_pass_expires,'epoch'::timestamptz),coalesce(v_priority_expires,'epoch'::timestamptz)),
      case when v_base_type<>'' then v_base_type when p_priority then 'priority' else null end,
      0;
    return;
  end if;

  if v_base_type<>'' and not v_base_active then v_charged:=v_charged+v_base_cost; end if;
  if p_priority and not v_priority_active then v_charged:=v_charged+3; end if;

  if v_charged>0 then
    v_balance:=public.spend_coins(
      p_user_id,v_charged,'match_pass',
      jsonb_build_object(
        'gender',p_gender_preference,
        'country',p_target_country,
        'level',p_target_level,
        'priority',p_priority,
        'hours',case when v_base_type='smart' then 24 else 12 end
      )
    );
  else
    v_balance:=public.available_coins(p_user_id);
  end if;

  if v_base_type<>'' and not v_base_active then
    v_pass_expires:=now()+make_interval(hours=>v_base_hours);
    insert into public.match_passes(user_id,pass_type,target_value,expires_at)
    values(p_user_id,v_base_type,v_base_target,v_pass_expires);
  end if;

  if p_priority and not v_priority_active then
    v_priority_expires:=now()+interval '12 hours';
    insert into public.match_passes(user_id,pass_type,target_value,expires_at)
    values(p_user_id,'priority','priority',v_priority_expires);
  end if;

  delete from public.waiting_users where user_id in(p_user_id,v_partner);
  insert into public.calls(caller_id,receiver_id,status)
  values(p_user_id,v_partner,'matched')
  returning id into v_call;

  return query
  select v_call,v_partner,v_balance,
    greatest(coalesce(v_pass_expires,'epoch'::timestamptz),coalesce(v_priority_expires,'epoch'::timestamptz)),
    case when v_base_type<>'' then v_base_type when p_priority then 'priority' else null end,
    v_charged;
end;
$function$
;
