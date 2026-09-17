-- Remove unused McEasy temperature webhook storage.
-- Webhook temperature was determined to be notification-oriented and is no
-- longer used by the TMS UI.

drop table if exists public.tms_webhook_events;
drop table if exists public.tms_temperature_events;
