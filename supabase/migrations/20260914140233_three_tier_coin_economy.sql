
insert into public.milestones(code,title,description,coin_reward) values
('firstwords','First Words','Complete your first real human conversation.',1),
('twotalks','Two Talks','Complete 2 real conversations.',1),
('warmup','Warm Up','Speak for 10 total minutes.',1),
('twodaystreak','Two-Day Streak','Practice on 2 consecutive days.',1),
('threeconversations','Three Conversations','Complete 3 real conversations.',1),
('fivealive','Five Alive','Complete 5 real conversations.',1),
('30minuteclub','30 Minute Club','Speak for 30 total minutes.',1),
('tentalks','Ten Talks','Complete 10 real conversations.',2),
('twentystrong','Twenty Strong','Complete 20 real conversations.',2),
('onehourin','One Hour In','Speak for 60 total minutes.',2),
('sevendaystreak','Seven-Day Streak','Practice for 7 consecutive days.',2),
('thirtyconversations','Thirty Conversations','Complete 30 real conversations.',2),
('threehourspeaker','Three Hour Speaker','Speak for 3 total hours.',2),
('fourteendaystreak','Fourteen-Day Streak','Practice for 14 consecutive days.',2),
('conversationbuilder','Conversation Builder','Complete 15 real conversations.',2),
('fluencymomentum','Fluency Momentum','Complete 25 real conversations.',2),
('halfcentury','Half Century','Complete 50 real conversations.',4),
('centuryspeaker','Century Speaker','Complete 100 real conversations.',4),
('fivehourspeaker','Five Hour Speaker','Speak for 5 total hours.',4),
('tenhourspeaker','Ten Hour Speaker','Speak for 10 total hours.',4),
('thirtydaystreak','Thirty-Day Streak','Practice for 30 consecutive days.',4),
('worldspeaker','World Speaker','Complete 75 real conversations.',4),
('twohundredconversations','Two Hundred Conversations','Complete 200 real conversations.',4),
('twentyhourspeaker','Twenty Hour Speaker','Speak for 20 total hours.',4)
on conflict(code) do update set title=excluded.title,description=excluded.description,coin_reward=excluded.coin_reward;

create or replace function public.award_eligible_milestones(p_user_id uuid)
returns table(newly_awarded text[], coins_earned integer, total_coins integer)
language plpgsql
security definer
set search_path=public
as $function$
declare
  conv integer;
  mins integer;
  streak integer := 0;
  d date;
  run integer := 0;
  last_d date;
  eligible jsonb := '[]'::jsonb;
  item jsonb;
  k text;
  c integer;
  awarded text[] := '{}';
  earned integer := 0;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;

  select count(*)::int into conv
  from public.calls
  where (caller_id=p_user_id or receiver_id=p_user_id) and status='completed';

  select coalesce(round(sum(coalesce(duration_seconds,0))/60.0),0)::int into mins
  from public.calls
  where (caller_id=p_user_id or receiver_id=p_user_id) and status='completed';

  for d in
    select distinct (ended_at at time zone 'UTC')::date
    from public.calls
    where (caller_id=p_user_id or receiver_id=p_user_id)
      and status='completed' and ended_at is not null
    order by 1 desc
  loop
    if last_d is null then run:=1;
    elsif d=last_d-1 then run:=run+1;
    else exit;
    end if;
    last_d:=d;
  end loop;
  streak:=run;

  -- Three-tier economy: easy +1, medium +2, hard +4.
  -- Coins stay scarce so paid packs and premium matching remain meaningful.
  eligible := jsonb_build_array(
    jsonb_build_object('k','firstwords','c',1,'ok',conv>=1),
    jsonb_build_object('k','twotalks','c',1,'ok',conv>=2),
    jsonb_build_object('k','warmup','c',1,'ok',mins>=10),
    jsonb_build_object('k','twodaystreak','c',1,'ok',streak>=2),
    jsonb_build_object('k','threeconversations','c',1,'ok',conv>=3),
    jsonb_build_object('k','fivealive','c',1,'ok',conv>=5),
    jsonb_build_object('k','30minuteclub','c',1,'ok',mins>=30),

    jsonb_build_object('k','tentalks','c',2,'ok',conv>=10),
    jsonb_build_object('k','twentystrong','c',2,'ok',conv>=20),
    jsonb_build_object('k','onehourin','c',2,'ok',mins>=60),
    jsonb_build_object('k','sevendaystreak','c',2,'ok',streak>=7),
    jsonb_build_object('k','thirtyconversations','c',2,'ok',conv>=30),
    jsonb_build_object('k','threehourspeaker','c',2,'ok',mins>=180),
    jsonb_build_object('k','fourteendaystreak','c',2,'ok',streak>=14),
    jsonb_build_object('k','conversationbuilder','c',2,'ok',conv>=15),
    jsonb_build_object('k','fluencymomentum','c',2,'ok',conv>=25),

    jsonb_build_object('k','halfcentury','c',4,'ok',conv>=50),
    jsonb_build_object('k','centuryspeaker','c',4,'ok',conv>=100),
    jsonb_build_object('k','fivehourspeaker','c',4,'ok',mins>=300),
    jsonb_build_object('k','tenhourspeaker','c',4,'ok',mins>=600),
    jsonb_build_object('k','thirtydaystreak','c',4,'ok',streak>=30),
    jsonb_build_object('k','worldspeaker','c',4,'ok',conv>=75),
    jsonb_build_object('k','twohundredconversations','c',4,'ok',conv>=200),
    jsonb_build_object('k','twentyhourspeaker','c',4,'ok',mins>=1200)
  );

  for item in select * from jsonb_array_elements(eligible)
  loop
    k:=item->>'k';
    c:=(item->>'c')::int;
    if (item->>'ok')::boolean then
      begin
        insert into public.user_milestone_rewards(user_id,milestone_key,coins)
        values(p_user_id,k,c);
        awarded:=array_append(awarded,k);
        earned:=earned+c;
      exception when unique_violation then null;
      end;
    end if;
  end loop;

  select coalesce(sum(coins),0)::int into c
  from public.user_milestone_rewards
  where user_id=p_user_id;

  return query select awarded, earned, c;
end;
$function$;
;
