-- Seed: 20 load-test products for the local "test-pharmacy shop", and keep its trial open.
-- Local environment only. Idempotent: skips SKUs that already exist.
-- Run: docker exec -i "$DB" psql -U postgres < target/tawira/seed.sql
INSERT INTO public.products
  (shop_id, branch_id, name, sku, buying_price, selling_price, stock, tracks_expiry)
SELECT
  'd841607b-9f0e-447b-998b-efec2e6d89e0'::uuid,
  'a5a9d2f8-a8b4-48cf-b005-dfb811eb6f53'::uuid,
  'LG Product ' || lpad(n::text, 2, '0'),
  'LG-' || lpad(n::text, 3, '0'),
  (50 + n * 5)::numeric(12,2),
  (80 + n * 8)::numeric(12,2),
  10000,
  false
FROM generate_series(1, 20) AS n
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.shop_id = 'd841607b-9f0e-447b-998b-efec2e6d89e0'::uuid
    AND p.sku = 'LG-' || lpad(n::text, 3, '0')
);

-- Test shop only. is_account_usable() blocks every read for non-super-admin users once
-- trial_ends_at + 5 days has passed, which silently starves the load generator.
-- Keep the local trial open. Only moves the date forward; never shortens it.
UPDATE public.shops
SET trial_ends_at = now() + interval '365 days'
WHERE id = 'd841607b-9f0e-447b-998b-efec2e6d89e0'::uuid
  AND (trial_ends_at IS NULL OR trial_ends_at < now() + interval '180 days');
