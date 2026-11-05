-- 0003: Netlify-ready engine hardening.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Admin access: allow-list table + grant the role once the email is confirmed
-- (covers Google sign-in AND email-code sign-in, where the email is confirmed
-- by an UPDATE after the user row is inserted).
-- ---------------------------------------------------------------------------
create table if not exists public.admin_emails (email text primary key);
alter table public.admin_emails enable row level security;
grant all on public.admin_emails to service_role;
insert into public.admin_emails(email) values ('teachersha557@gmail.com') on conflict do nothing;

create or replace function public.grant_admin_by_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from public.admin_emails a where a.email = lower(new.email)) then
    insert into public.user_roles(user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_admin on auth.users;
create trigger on_auth_user_admin
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.grant_admin_by_email();
insert into public.user_roles(user_id, role)
  select u.id, 'admin' from auth.users u
  join public.admin_emails a on a.email = lower(u.email)
  where u.email_confirmed_at is not null
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Extra columns
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists cancelled_at timestamptz;
alter table public.bookings add column if not exists payment_mode text not null default 'link';
alter table public.bookings add column if not exists last_checked_at timestamptz;
alter table public.payments add column if not exists booking_id uuid references public.bookings(id);
alter table public.class_sessions add column if not exists event_claimed_at timestamptz;
alter table public.email_logs add column if not exists attempts int not null default 0;
alter table public.email_logs add column if not exists attempted_at timestamptz;
alter table public.webhook_logs add column if not exists dedupe_key text;
create unique index if not exists webhook_logs_dedupe on public.webhook_logs(dedupe_key) where dedupe_key is not null;
create index if not exists bookings_student on public.bookings(student_id);
create index if not exists booking_classes_class on public.booking_classes(class_id);

-- ---------------------------------------------------------------------------
-- create_booking v2: same signature; adds per-student serialisation,
-- idempotent re-submit and protection against overlapping packages.
-- ---------------------------------------------------------------------------
create or replace function public.create_booking(_ref text, _name text, _email text, _whatsapp text, _consent boolean, _start date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _sid uuid; _bid uuid; _ids uuid[] := '{}'; i int; _full date[] := '{}'; _ex record;
begin
  if extract(isodow from _start) <> 2 then raise exception 'NOT_TUESDAY'; end if;
  insert into students(name, email, whatsapp, whatsapp_consent)
  values (_name, lower(_email), _whatsapp, _consent)
  on conflict (email) do update set name = excluded.name,
    whatsapp = coalesce(excluded.whatsapp, students.whatsapp),
    whatsapp_consent = excluded.whatsapp_consent, active = true
  returning id into _sid;
  perform 1 from students where id = _sid for update;

  -- An active package for this student that shares any of the four Tuesdays?
  select b.id, b.reference, b.start_date, b.status into _ex
  from bookings b
  where b.student_id = _sid
    and (b.status in ('confirmed', 'needs_resolution') or (b.status = 'held' and b.hold_expires_at > now()))
    and abs(b.start_date - _start) < 28
  order by b.created_at desc limit 1;
  if found then
    if _ex.status = 'held' and _ex.start_date = _start then
      return jsonb_build_object('ok', true, 'booking_id', _ex.id, 'reference', _ex.reference, 'existing', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_BOOKED', 'reference', _ex.reference, 'status', _ex.status);
  end if;

  for i in 0..3 loop _ids := _ids || public.ensure_session(_start + i*7); end loop;
  perform 1 from class_sessions where id = any(_ids) order by class_date for update;
  for i in 1..4 loop
    if public.seats_taken(_ids[i]) >= (select capacity from class_sessions where id = _ids[i]) then
      _full := _full || (_start + (i-1)*7);
    end if;
  end loop;
  if array_length(_full, 1) > 0 then
    return jsonb_build_object('ok', false, 'error', 'FULL', 'full_dates', to_jsonb(_full));
  end if;
  insert into bookings(reference, student_id, start_date, hold_expires_at)
  values (_ref, _sid, _start, now() + interval '20 minutes') returning id into _bid;
  for i in 1..4 loop insert into booking_classes(booking_id, class_id, position) values (_bid, _ids[i], i); end loop;
  return jsonb_build_object('ok', true, 'booking_id', _bid, 'reference', _ref, 'existing', false);
end $$;

-- Public seat availability for the next N Tuesdays (no personal data).
create or replace function public.class_availability(_from date, _weeks int default 12)
returns table(class_date date, capacity int, taken int)
language sql stable security definer set search_path = public as $$
  select d::date,
         coalesce(cs.capacity, 10),
         coalesce(public.seats_taken(cs.id), 0)
  from generate_series(_from, _from + (greatest(least(_weeks, 26), 1) - 1) * 7, interval '7 days') d
  left join class_sessions cs on cs.class_date = d::date
  order by 1
$$;

revoke execute on function public.create_booking, public.class_availability from public, anon, authenticated;
grant execute on function public.create_booking, public.class_availability to service_role;
