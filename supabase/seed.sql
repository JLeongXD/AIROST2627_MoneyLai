-- Optional fictional demo activity. Run as project owner after setup.
insert into public.activities(name,description,budget,event_date)
select 'Robotics Workshop','Hands-on robotics workshop for club members.',1000,null
where not exists(select 1 from public.activities where name='Robotics Workshop');
