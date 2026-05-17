-- BNDR | SPEX database setup for Supabase PostgreSQL.
-- Run this entire file in the Supabase SQL Editor before deploying the app.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  stripe_customer_id text unique,
  subscription_id text unique,
  subscription_status text not null default 'none',
  subscription_current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  single_spec_credits integer not null default 0 check (single_spec_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.specs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('system', 'schema')),
  title text not null,
  input jsonb not null,
  output jsonb not null,
  model text,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  id text primary key,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create index if not exists profiles_stripe_customer_idx on public.profiles(stripe_customer_id);
create index if not exists profiles_subscription_idx on public.profiles(subscription_id);
create index if not exists specs_user_created_idx on public.specs(user_id, created_at desc);
create index if not exists specs_type_idx on public.specs(type);

alter table public.profiles enable row level security;
alter table public.specs enable row level security;
alter table public.billing_events enable row level security;

-- Recreate policies idempotently.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own_safe" on public.profiles;
drop policy if exists "specs_select_own" on public.specs;
drop policy if exists "specs_insert_own" on public.specs;
drop policy if exists "specs_update_own" on public.specs;
drop policy if exists "specs_delete_own" on public.specs;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- Authenticated users may update only non-billing profile fields. Server-side service role bypasses RLS for billing changes.
create policy "profiles_update_own_safe" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "specs_select_own" on public.specs
  for select to authenticated
  using (auth.uid() = user_id);

create policy "specs_insert_own" on public.specs
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "specs_update_own" on public.specs
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "specs_delete_own" on public.specs
  for delete to authenticated
  using (auth.uid() = user_id);

-- No client policy is created for billing_events. Only service role should write/read it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_specs_updated_at on public.specs;
create trigger set_specs_updated_at
before update on public.specs
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.grant_spec_credits(target_user uuid, credit_count integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if credit_count <= 0 then
    raise exception 'credit_count must be positive';
  end if;

  insert into public.profiles (id, single_spec_credits)
  values (target_user, credit_count)
  on conflict (id) do update
    set single_spec_credits = public.profiles.single_spec_credits + excluded.single_spec_credits,
        updated_at = now();
  return true;
end;
$$;

create or replace function public.consume_spec_credit(target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set single_spec_credits = single_spec_credits - 1,
      updated_at = now()
  where id = target_user
    and single_spec_credits > 0;
  return found;
end;
$$;

create or replace function public.save_spec_with_credit(
  target_user uuid,
  spec_type text,
  spec_title text,
  spec_input jsonb,
  spec_output jsonb,
  spec_model text,
  spec_request_id text
)
returns public.specs
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.specs;
begin
  if spec_type not in ('system', 'schema') then
    raise exception 'invalid spec_type';
  end if;

  update public.profiles
  set single_spec_credits = single_spec_credits - 1,
      updated_at = now()
  where id = target_user
    and single_spec_credits > 0;

  if not found then
    raise exception 'No generation credit available';
  end if;

  insert into public.specs (user_id, type, title, input, output, model, request_id)
  values (target_user, spec_type, coalesce(nullif(spec_title, ''), 'Untitled spec'), spec_input, spec_output, spec_model, spec_request_id)
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.record_billing_event_once(event_id text, event_type text, event_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.billing_events (id, event_type, payload)
  values (event_id, event_type, event_payload)
  on conflict (id) do nothing;
  return found;
end;
$$;

revoke all on function public.grant_spec_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.consume_spec_credit(uuid) from public, anon, authenticated;
revoke all on function public.save_spec_with_credit(uuid, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.record_billing_event_once(text, text, jsonb) from public, anon, authenticated;

grant execute on function public.grant_spec_credits(uuid, integer) to service_role;
grant execute on function public.consume_spec_credit(uuid) to service_role;
grant execute on function public.save_spec_with_credit(uuid, text, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.record_billing_event_once(text, text, jsonb) to service_role;


-- Security hardening: prevent direct browser/RPC execution of privileged helper functions.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.record_billing_event_once(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.save_spec_with_credit(uuid, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.grant_spec_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.consume_spec_credit(uuid) from public, anon, authenticated;

grant execute on function public.record_billing_event_once(text, text, jsonb) to service_role;
grant execute on function public.save_spec_with_credit(uuid, text, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.grant_spec_credits(uuid, integer) to service_role;
grant execute on function public.consume_spec_credit(uuid) to service_role;
