-- Run this in Supabase SQL Editor (or psql) to change order_number from INT to TEXT
-- without resetting the database. Then run: npx prisma generate

ALTER TABLE shopify_orders
  ALTER COLUMN order_number TYPE text USING order_number::text;
