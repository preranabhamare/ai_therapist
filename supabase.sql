begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  avatar_url text,
  timezone text default 'Asia/Calcutta',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.therapy_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  summary text,
  session_status text not null default 'active'
    check (session_status in ('active', 'completed', 'archived')),
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  initial_mood_value smallint check (initial_mood_value between 1 and 5),
  final_mood_value smallint check (final_mood_value between 1 and 5),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.therapy_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('user', 'assistant', 'system')),
  content text not null,
  content_type text not null default 'text' check (content_type in ('text', 'markdown', 'json')),
  sequence_no integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, sequence_no)
);

create table if not exists public.mood_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null unique,
  tag_type text not null default 'feeling'
    check (tag_type in ('feeling', 'trigger', 'coping', 'energy')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.therapy_sessions(id) on delete set null,
  mood_value smallint not null check (mood_value between 1 and 5),
  anxiety_level smallint check (anxiety_level between 1 and 5),
  energy_level smallint check (energy_level between 1 and 5),
  note text,
  source text not null default 'manual'
    check (source in ('manual', 'pre_session', 'post_session', 'exercise')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mood_entry_tags (
  mood_entry_id uuid not null references public.mood_entries(id) on delete cascade,
  tag_id uuid not null references public.mood_tags(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (mood_entry_id, tag_id)
);

create table if not exists public.guided_exercises (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  subtitle text,
  description text not null,
  exercise_type text not null
    check (exercise_type in ('breathing', 'grounding', 'cbt', 'journaling', 'mindfulness')),
  default_duration_seconds integer,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.exercise_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id uuid not null references public.guided_exercises(id) on delete restrict,
  session_id uuid references public.therapy_sessions(id) on delete set null,
  completion_status text not null default 'completed'
    check (completion_status in ('started', 'completed', 'skipped')),
  duration_seconds integer,
  notes text,
  result_data jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create index if not exists idx_therapy_sessions_user_started_at
  on public.therapy_sessions (user_id, started_at desc);

create index if not exists idx_session_messages_session_sequence
  on public.session_messages (session_id, sequence_no);

create index if not exists idx_mood_entries_user_created_at
  on public.mood_entries (user_id, created_at desc);

create index if not exists idx_mood_entries_session_id
  on public.mood_entries (session_id);

create index if not exists idx_exercise_completions_user_started_at
  on public.exercise_completions (user_id, started_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_therapy_sessions_updated_at on public.therapy_sessions;
create trigger trg_therapy_sessions_updated_at
before update on public.therapy_sessions
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_mood_entries_updated_at on public.mood_entries;
create trigger trg_mood_entries_updated_at
before update on public.mood_entries
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_guided_exercises_updated_at on public.guided_exercises;
create trigger trg_guided_exercises_updated_at
before update on public.guided_exercises
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.therapy_sessions enable row level security;
alter table public.session_messages enable row level security;
alter table public.mood_tags enable row level security;
alter table public.mood_entries enable row level security;
alter table public.mood_entry_tags enable row level security;
alter table public.guided_exercises enable row level security;
alter table public.exercise_completions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "therapy_sessions_own_all" on public.therapy_sessions;
create policy "therapy_sessions_own_all"
on public.therapy_sessions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "session_messages_own_all" on public.session_messages;
create policy "session_messages_own_all"
on public.session_messages
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "mood_entries_own_all" on public.mood_entries;
create policy "mood_entries_own_all"
on public.mood_entries
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "mood_entry_tags_own_all" on public.mood_entry_tags;
create policy "mood_entry_tags_own_all"
on public.mood_entry_tags
for all
to authenticated
using (
  exists (
    select 1
    from public.mood_entries me
    where me.id = mood_entry_id
      and me.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.mood_entries me
    where me.id = mood_entry_id
      and me.user_id = auth.uid()
  )
);

drop policy if exists "exercise_completions_own_all" on public.exercise_completions;
create policy "exercise_completions_own_all"
on public.exercise_completions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "mood_tags_read_all" on public.mood_tags;
create policy "mood_tags_read_all"
on public.mood_tags
for select
to authenticated
using (true);

drop policy if exists "guided_exercises_read_all" on public.guided_exercises;
create policy "guided_exercises_read_all"
on public.guided_exercises
for select
to authenticated
using (is_active = true);

insert into public.mood_tags (slug, label, tag_type)
values
  ('hopeful', 'Hopeful', 'feeling'),
  ('anxious', 'Anxious', 'feeling'),
  ('grateful', 'Grateful', 'feeling'),
  ('tired', 'Tired', 'energy'),
  ('stressed', 'Stressed', 'trigger'),
  ('calm', 'Calm', 'feeling')
on conflict (slug) do update
set label = excluded.label,
    tag_type = excluded.tag_type;

insert into public.guided_exercises (
  slug,
  title,
  subtitle,
  description,
  exercise_type,
  default_duration_seconds,
  config
)
values
  (
    'box-breathing',
    'Box Breathing',
    'Calm your nervous system',
    'Inhale, hold, exhale, hold. Four seconds each.',
    'breathing',
    240,
    '{"phases":[{"label":"Inhale","seconds":4},{"label":"Hold","seconds":4},{"label":"Exhale","seconds":4},{"label":"Hold","seconds":4}],"cycles":4}'::jsonb
  ),
  (
    'grounding-5-4-3-2-1',
    '5-4-3-2-1 Grounding',
    'Return to the present',
    'Use your five senses to anchor yourself during anxiety.',
    'grounding',
    180,
    '{"steps":["5 things you can see","4 things you can feel","3 things you can hear","2 things you can smell","1 thing you can taste"]}'::jsonb
  ),
  (
    'thought-record',
    'Thought Record',
    'Challenge negative thinking',
    'Capture a thought, examine evidence, and reframe it.',
    'cbt',
    300,
    '{"fields":["situation","thought","emotion","evidence_for","evidence_against","balanced_thought"]}'::jsonb
  )
on conflict (slug) do update
set title = excluded.title,
    subtitle = excluded.subtitle,
    description = excluded.description,
    exercise_type = excluded.exercise_type,
    default_duration_seconds = excluded.default_duration_seconds,
    config = excluded.config,
    is_active = true;

commit;
