-- Interface language files for the app (Bengali / English / Bishnupriya Manipuri).
--
-- One row per language, holding that language's CSV. The dashboard edits the
-- rows; the Android app asks for the language the reader chose, caches the CSV
-- and falls back to the Bengali strings compiled into the app for anything the
-- file does not translate yet.
--
-- CSV shape is deliberately boring — `key,value`, one pair per line, keys being
-- the Bengali source strings written in the app:
--
--     গান,Elahan
--     "শিরোনাম, বই","Title, book"
--
-- The key column is the identity: the app looks its Bengali literal up by key.
-- A missing or blank value means "not translated", never "empty text".

begin;

create table if not exists public.app_language_files (
  lang text primary key,
  label text not null default '',
  csv text not null default '',
  row_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.app_language_files is
  'Interface language files (key,value CSV) served to the Android app; managed from the dashboard Languages page.';
comment on column public.app_language_files.csv is
  'key,value CSV, keys = Bengali source strings. Blank value = fall back to the app''s Bengali text.';

-- The app reads the language it needs and checks the timestamp to know whether
-- its cached copy is stale.
grant select on public.app_language_files to anon, authenticated;
grant insert, update, delete on public.app_language_files to anon, authenticated;

alter table public.app_language_files enable row level security;

drop policy if exists app_language_files_public_select on public.app_language_files;
create policy app_language_files_public_select on public.app_language_files
for select to anon, authenticated
using (true);

drop policy if exists app_language_files_manage_insert on public.app_language_files;
create policy app_language_files_manage_insert on public.app_language_files
for insert to anon, authenticated
with check (public.dashboard_has_permission('settings'));

drop policy if exists app_language_files_manage_update on public.app_language_files;
create policy app_language_files_manage_update on public.app_language_files
for update to anon, authenticated
using (public.dashboard_has_permission('settings'))
with check (public.dashboard_has_permission('settings'));

drop policy if exists app_language_files_manage_delete on public.app_language_files;
create policy app_language_files_manage_delete on public.app_language_files
for delete to anon, authenticated
using (public.dashboard_has_permission('settings'));

drop trigger if exists app_language_files_set_updated_at on public.app_language_files;
create trigger app_language_files_set_updated_at
before update on public.app_language_files
for each row execute function public.set_updated_at();

-- Seeds the three supported rows empty. The dashboard's Languages page fills
-- them from the committed templates in assets/lang/ (or by pasting a CSV), so
-- no translation text lives in this migration.
insert into public.app_language_files (lang, label) values
  ('bn', 'বাংলা'),
  ('en', 'English'),
  ('bpy', 'বিষ্ণুপ্রিয়া মণিপুরী')
on conflict (lang) do update set label = excluded.label;

notify pgrst, 'reload schema';

commit;
