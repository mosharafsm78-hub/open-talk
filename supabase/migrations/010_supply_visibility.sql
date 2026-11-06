-- Who is around: honest availability before anyone picks a gender/country.
alter table public.profiles add column if not exists last_active timestamptz not null default now();

create or replace function public.touch_active()
returns void language sql security definer set search_path = public as $$
  update profiles set last_active = now()
   where id = auth.uid() and last_active < now() - interval '1 minute';
$$;

create or replace function public.get_supply()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'male_online',    (select count(*) from profiles where gender = 'male'   and id <> auth.uid() and last_active > now() - interval '30 minutes'),
    'female_online',  (select count(*) from profiles where gender = 'female' and id <> auth.uid() and last_active > now() - interval '30 minutes'),
    'male_members',   (select count(*) from profiles where gender = 'male'),
    'female_members', (select count(*) from profiles where gender = 'female'),
    'countries',      coalesce((select jsonb_object_agg(country, n) from (
                         select country, count(*) n from profiles
                          where id <> auth.uid() and country <> '' and last_active > now() - interval '30 minutes'
                          group by country) t), '{}'::jsonb)
  );
$$;

revoke all on function public.touch_active, public.get_supply from public, anon;
grant execute on function public.touch_active, public.get_supply to authenticated;
