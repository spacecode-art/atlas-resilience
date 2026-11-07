-- Read-only. psql -X -qAt -v run_id=sc02a -f export-ledger.sql
-- run_id is passed as a quoted psql literal, not interpolated into shell SQL.
BEGIN READ ONLY;
SELECT COALESCE(json_agg(t), '[]'::json)
FROM (
  SELECT mpesa_ref, count(*) AS rows, json_agg(id ORDER BY id) AS sale_ids
  FROM public.sales
  WHERE shop_id = 'd841607b-9f0e-447b-998b-efec2e6d89e0'::uuid
    AND mpesa_ref LIKE 'lg-' || :'run_id' || '-%'
  GROUP BY mpesa_ref
  ORDER BY mpesa_ref
) AS t;
COMMIT;
