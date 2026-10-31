-- The worker tick, scheduled inside Postgres.
--
-- Applied by hand (prisma/BASELINE.md: this database has no migration history,
-- so `prisma migrate deploy` is unsupported and schema/extension changes ship as
-- reviewed SQL). Replacing <WORKER_TICK_SECRET> with the value in Vercel
-- (Production) is the only edit needed; the key is stored in cron.job.command,
-- which only the database owner can read.
--
-- What it does: every minute, pg_net POSTs /api/worker/tick, which drains the
-- `jobs` queue and sends any digest that is due. The endpoint is capped at 45 s
-- and the schedule fires every 60 s, so two ticks never overlap.
--
-- Check it is live:
--   select jobname, schedule, active from cron.job where jobname = 'commitit-worker-tick';
--   select status_code, content from net._http_response order by id desc limit 5;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('commitit-worker-tick')
where exists (select 1 from cron.job where jobname = 'commitit-worker-tick');

select cron.schedule(
  'commitit-worker-tick',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://commitit-web.vercel.app/api/worker/tick',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-worker-key', '<WORKER_TICK_SECRET>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 40000
  );
  $cron$
);
