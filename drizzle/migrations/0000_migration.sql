
create type public.app_role as enum ('admin');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

create table public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  whatsapp text,
  whatsapp_consent boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_date date not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  capacity int not null default 10,
  calendar_event_id text,
  meet_link text,
  event_status text not null default 'pending',
  event_error text,
  created_at timestamptz not null default now()
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  student_id uuid not null references public.students(id),
  start_date date not null,
  price numeric(10,2) not null default 49,
  payment_status text not null default 'pending',
  status text not null default 'held',
  hold_expires_at timestamptz,
  payment_link text,
  resolution_note text,
  calendar_status text not null default 'pending',
  calendar_error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index on public.bookings(status);
create table public.booking_classes (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  class_id uuid not null references public.class_sessions(id),
  position int not null,
  attendee_added boolean not null default false,
  primary key (booking_id, class_id)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  booking_reference text,
  amount numeric(10,2),
  subtotal numeric(10,2),
  currency text,
  status text,
  is_paid boolean not null default false,
  verification_result text,
  verified_at timestamptz,
  resolution_status text not null default 'none',
  audit jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id),
  booking_id uuid references public.bookings(id),
  type text not null,
  class_date date,
  scheduled_for timestamptz,
  sent_at timestamptz,
  whatsapp_number text,
  status text not null default 'scheduled',
  provider_message_id text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (type, booking_id, class_date)
);
create unique index notif_provider_id on public.notifications(provider_message_id) where provider_message_id is not null;
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id),
  recipient text not null,
  email_type text not null,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (booking_id, email_type)
);
create table public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'bcl',
  event_type text,
  order_number text,
  booking_reference text,
  status text not null default 'received',
  error text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null unique,
  event text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  attempts int not null default 0
);

do $$ declare t text; begin
  foreach t in array array['students','class_sessions','bookings','booking_classes','payments','notifications','email_logs','webhook_logs','whatsapp_webhook_events'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admin all" on public.%I for all to authenticated using (public.has_role(auth.uid(), ''admin'')) with check (public.has_role(auth.uid(), ''admin''))', t);
  end loop;
end $$;

-- seats taken = confirmed + unexpired holds (excluding a given booking)
create or replace function public.seats_taken(_class_id uuid, _exclude uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from booking_classes bc join bookings b on b.id = bc.booking_id
  where bc.class_id = _class_id and b.id is distinct from _exclude
    and (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now()))
$$;

create or replace function public.ensure_session(_d date)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid; begin
  insert into class_sessions(class_date, starts_at, ends_at)
  values (_d, (_d + time '20:00') at time zone 'Asia/Kuala_Lumpur', (_d + time '21:00') at time zone 'Asia/Kuala_Lumpur')
  on conflict (class_date) do nothing;
  select id into _id from class_sessions where class_date = _d;
  return _id;
end $$;

create or replace function public.create_booking(_ref text, _name text, _email text, _whatsapp text, _consent boolean, _start date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _sid uuid; _bid uuid; _ids uuid[] := '{}'; _cid uuid; i int; _full date[] := '{}';
begin
  if extract(isodow from _start) <> 2 then raise exception 'NOT_TUESDAY'; end if;
  insert into students(name, email, whatsapp, whatsapp_consent)
  values (_name, lower(_email), _whatsapp, _consent)
  on conflict (email) do update set name = excluded.name, whatsapp = excluded.whatsapp,
    whatsapp_consent = excluded.whatsapp_consent, active = true
  returning id into _sid;
  for i in 0..3 loop _ids := _ids || public.ensure_session(_start + i*7); end loop;
  perform 1 from class_sessions where id = any(_ids) order by class_date for update;
  for i in 1..4 loop
    if public.seats_taken(_ids[i]) >= (select capacity from class_sessions where id = _ids[i]) then
      _full := _full || (_start + (i-1)*7);
    end if;
  end loop;
  if array_length(_full,1) > 0 then
    return jsonb_build_object('ok', false, 'error', 'FULL', 'full_dates', to_jsonb(_full));
  end if;
  insert into bookings(reference, student_id, start_date, hold_expires_at)
  values (_ref, _sid, _start, now() + interval '20 minutes') returning id into _bid;
  for i in 1..4 loop insert into booking_classes(booking_id, class_id, position) values (_bid, _ids[i], i); end loop;
  return jsonb_build_object('ok', true, 'booking_id', _bid);
end $$;

-- Called after a payment is verified. Idempotent. All-or-nothing.
create or replace function public.confirm_booking(_bid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare b bookings; r record;
begin
  select * into b from bookings where id = _bid for update;
  if b.status = 'confirmed' then return 'already_confirmed'; end if;
  if b.status = 'cancelled' then
    update bookings set payment_status='paid', resolution_note='Paid after cancellation' where id=_bid;
    return 'needs_resolution';
  end if;
  perform 1 from class_sessions cs join booking_classes bc on bc.class_id = cs.id
    where bc.booking_id = _bid order by cs.class_date for update of cs;
  for r in select cs.id, cs.capacity, cs.class_date from booking_classes bc join class_sessions cs on cs.id = bc.class_id where bc.booking_id = _bid loop
    if public.seats_taken(r.id, _bid) >= r.capacity then
      update bookings set payment_status='paid', status='needs_resolution',
        resolution_note = 'Paid but class on ' || r.class_date || ' is full' where id=_bid;
      return 'needs_resolution';
    end if;
  end loop;
  update bookings set status='confirmed', payment_status='paid', confirmed_at=now(), hold_expires_at=null where id=_bid;
  return 'confirmed';
end $$;

create or replace function public.expire_holds()
returns int language sql security definer set search_path = public as $$
  with u as (update bookings set status='expired' where status='held' and hold_expires_at <= now() returning 1)
  select count(*)::int from u
$$;

revoke execute on function public.create_booking, public.confirm_booking, public.expire_holds, public.ensure_session, public.seats_taken from public, anon, authenticated;
grant execute on function public.create_booking, public.confirm_booking, public.expire_holds, public.ensure_session, public.seats_taken to service_role;
