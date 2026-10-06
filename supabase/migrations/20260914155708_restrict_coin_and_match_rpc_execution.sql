revoke execute on function public.available_coins(uuid) from public;
revoke execute on function public.award_eligible_milestones(uuid) from public;
revoke execute on function public.find_and_claim_match(uuid,text,text,text) from public;
revoke execute on function public.find_and_claim_match_v2(uuid,text,text,text,boolean,integer) from public;
revoke execute on function public.spend_coins(uuid,integer,text,jsonb) from public;;
