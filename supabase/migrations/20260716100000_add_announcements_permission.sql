-- Add Pengumuman as a standalone permission while preserving existing access.
-- Previously /employees/announcements reused the employees permission.

UPDATE public.roles
SET permissions = permissions || '["announcements"]'::jsonb
WHERE permissions ? 'employees'
  AND NOT (permissions ? 'announcements')
  AND NOT (permissions ? 'all');

UPDATE public.roles
SET permissions = permissions || '["announcements.input"]'::jsonb
WHERE permissions ? 'employees.input'
  AND NOT (permissions ? 'announcements')
  AND NOT (permissions ? 'announcements.input')
  AND NOT (permissions ? 'all');

UPDATE public.roles
SET permissions = permissions || '["announcements.view"]'::jsonb
WHERE permissions ? 'employees.view'
  AND NOT (permissions ? 'announcements')
  AND NOT (permissions ? 'announcements.input')
  AND NOT (permissions ? 'announcements.view')
  AND NOT (permissions ? 'all');
