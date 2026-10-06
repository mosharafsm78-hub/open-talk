alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id,name,public)
values ('profile-avatars','profile-avatars',true)
on conflict (id) do update set public=true;

drop policy if exists "profile avatars public read" on storage.objects;
create policy "profile avatars public read"
on storage.objects for select
to public
using (bucket_id='profile-avatars');

drop policy if exists "profile avatars own upload" on storage.objects;
create policy "profile avatars own upload"
on storage.objects for insert
to authenticated
with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "profile avatars own update" on storage.objects;
create policy "profile avatars own update"
on storage.objects for update
to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "profile avatars own delete" on storage.objects;
create policy "profile avatars own delete"
on storage.objects for delete
to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);;
