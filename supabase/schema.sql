create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null,
 age integer check(age between 13 and 100),
 country text,
 gender text,
 level text,
 locked_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 partner_id uuid references auth.users(id) on delete set null,
 duration_seconds integer not null default 0,
 transcript text,
 ai_level text,
 ai_feedback jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.reports (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references auth.users(id) on delete cascade,
 reported_user_id uuid not null references auth.users(id) on delete cascade,
 reason text not null,
 status text not null default 'pending',
 created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.reports enable row level security;
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all using(auth.uid()=id) with check(auth.uid()=id);
drop policy if exists conversations_self on public.conversations;
create policy conversations_self on public.conversations for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check(auth.uid()=reporter_id);
