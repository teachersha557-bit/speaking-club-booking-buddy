create or replace function public.grant_admin_by_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'teachesha557@gmail.com' then
    insert into public.user_roles(user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_admin on auth.users;
create trigger on_auth_user_admin after insert on auth.users for each row execute function public.grant_admin_by_email();
insert into public.user_roles(user_id, role) select id, 'admin' from auth.users where lower(email) = 'teachesha557@gmail.com' on conflict do nothing;