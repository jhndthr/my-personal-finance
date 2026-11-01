
-- PERSONAL EXPENSE TRACKER DATABASE

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  starting_budget numeric(12,2) not null default 0,
  starting_savings numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null,
  transaction_date date not null,
  account text not null check (account in ('budget','savings')),
  category text not null,
  notes text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;

create policy "Own profile access"
on public.profiles for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Own transaction access"
on public.transactions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete
on public.profiles, public.transactions to authenticated;
