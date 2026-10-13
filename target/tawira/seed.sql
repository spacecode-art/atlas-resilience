-- Seed: 20 load-test products for the local "test-pharmacy shop".
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