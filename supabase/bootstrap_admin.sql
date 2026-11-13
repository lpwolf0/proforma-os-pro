-- Run AFTER you created your user in Authentication > Users.
-- Replace the email below with yours. Only ONE administrator can ever exist.
-- If this project already runs Invoice OS you are already the administrator: skip this file.
insert into public.admin_profile (user_id, display_name)
select id, 'Administrator' from auth.users where email = 'YOU@EXAMPLE.COM'
on conflict do nothing;
