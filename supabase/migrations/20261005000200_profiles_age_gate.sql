-- Age gate. Adds profiles.date_of_birth (nullable: existing rows have none and
-- are left untouched) and enforces 18+ in the database, so a client that skips
-- the signup form cannot get around it.
alter table public.profiles add column if not exists date_of_birth date;

-- Server-side rule. SECURITY DEFINER is not used here: the trigger runs as the
-- caller and only reads the caller's own JWT claims.
create or replace function public.profiles_enforce_age_gate()
returns trigger
language plpgsql
as $$
declare
  v_meta text;
  v_dob date;
begin
  v_dob := new.date_of_birth;

  if tg_op = 'INSERT' then
    -- An upsert that lands on an existing row fires INSERT triggers first.
    -- Rows that already exist keep whatever DOB they have (including none).
    if v_dob is null and exists (select 1 from public.profiles where id = new.id) then
      return new;
    end if;
    -- Email-confirmation signups create the profile later; fall back to the
    -- date of birth captured at signup in the user's auth metadata.
    if v_dob is null then
      v_meta := nullif(auth.jwt() -> 'user_metadata' ->> 'date_of_birth', '');
      begin
        v_dob := v_meta::date;
      exception when others then
        v_dob := null;
      end;
      new.date_of_birth := v_dob;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Only validate when the value is being changed; legacy rows with no DOB
    -- can still update their other fields.
    if new.date_of_birth is not distinct from old.date_of_birth then
      return new;
    end if;
  end if;

  if v_dob is null then
    raise exception 'date of birth is required' using errcode = '23514';
  end if;
  if v_dob > current_date or v_dob < date '1900-01-01' then
    raise exception 'invalid date of birth' using errcode = '23514';
  end if;
  if v_dob > (current_date - interval '18 years')::date then
    raise exception 'you must be at least 18 years old to use Open Talk' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_age_gate on public.profiles;
create trigger profiles_age_gate
before insert or update on public.profiles
for each row execute function public.profiles_enforce_age_gate();

-- Matching gate. Called by find_and_claim_match_v2 before anything else, so a
-- profile without a verified 18+ date of birth can never join the queue or be
-- charged. Accounts that predate the age rule keep working for everything
-- except matching until they provide a date of birth.
create or replace function public.assert_adult(p_user_id uuid)
returns void
language plpgsql
as $fn$
declare
  v_dob date;
begin
  select date_of_birth into v_dob from public.profiles where id = p_user_id;
  if v_dob is null then
    raise exception 'age_verification_required: date of birth is required before matching' using errcode = 'P0001';
  end if;
  if v_dob > (current_date - interval '18 years')::date then
    raise exception 'under_18: Open Talk is for people aged 18 and over' using errcode = 'P0001';
  end if;
end;
$fn$;
