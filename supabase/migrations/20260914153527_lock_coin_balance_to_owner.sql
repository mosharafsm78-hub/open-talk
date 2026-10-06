create or replace function public.available_coins(p_user_id uuid)
returns integer language plpgsql stable security definer set search_path=public as $$
declare v_total integer;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'not authorized'; end if;
  select greatest(0,
    coalesce((select sum(coins) from public.user_milestone_rewards where user_id=p_user_id),0)
    + coalesce((select sum(amount) from public.coin_transactions where user_id=p_user_id),0)
  )::int into v_total;
  return v_total;
end;
$$;;
