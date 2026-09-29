-- 0175: payments.amount and payments.monthly_price hold paise.
--
-- Both were integer from the baseline / 0006, but razorpay-order writes the
-- GST-inclusive grand total into amount, and 18% GST on a whole-rupee price
-- often lands on paise (e.g. 212.40). Postgres refused the insert with
-- "invalid input syntax for type integer", so checkout failed before Razorpay
-- was ever called. numeric(12,2) matches taxable_value / tax_total (0007).
-- Widening integer -> numeric is lossless; no view depends on either column.

alter table payments alter column amount type numeric(12,2) using amount::numeric(12,2);
alter table payments alter column monthly_price type numeric(12,2) using monthly_price::numeric(12,2);
