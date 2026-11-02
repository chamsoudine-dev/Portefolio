-- À exécuter une fois dans Supabase > SQL Editor
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null, email text not null unique,
  phone text, organization text, lang text, timezone text,
  referrer text, user_agent text,
  status text not null default 'nouveau' check (status in ('nouveau','contacte','qualifie','archive')),
  notes text default ''
);
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null, due date,
  done boolean not null default false,
  lead_id uuid references leads(id) on delete set null
);
alter table leads enable row level security;
alter table tasks enable row level security;
-- Aucune policy : seule la clé service (côté serveur) peut lire/écrire.
