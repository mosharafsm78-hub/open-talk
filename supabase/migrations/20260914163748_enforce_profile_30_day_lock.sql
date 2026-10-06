create or replace function public.prevent_locked_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.locked_until is not null and old.locked_until > now() then
    raise exception 'PROFILE_LOCKED_UNTIL:%', old.locked_until::text
      using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_30_day_lock on public.profiles;
create trigger profiles_30_day_lock
before update on public.profiles
for each row
execute function public.prevent_locked_profile_update();;
