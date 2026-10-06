revoke execute on function public.available_coins(uuid) from anon;
revoke execute on function public.award_eligible_milestones(uuid) from anon;
revoke execute on function public.find_and_claim_match(uuid,text,text,text) from anon;
revoke execute on function public.find_and_claim_match_v2(uuid,text,text,text,boolean,integer) from anon;
revoke execute on function public.spend_coins(uuid,integer,text,jsonb) from anon;

create index if not exists waiting_users_joined_idx on public.waiting_users(priority desc, joined_at asc);
create index if not exists calls_participants_status_idx on public.calls(caller_id, receiver_id, status, created_at desc);
create index if not exists coin_transactions_user_created_idx on public.coin_transactions(user_id, created_at desc);
create index if not exists match_passes_active_idx on public.match_passes(user_id, pass_type, target_value, expires_at);;
