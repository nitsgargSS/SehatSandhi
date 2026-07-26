--
-- Sehatsandhi baseline schema
--
-- Dumped from PRODUCTION (ref ctxkkqqtasegoowuqbmi, PostgreSQL 17.6) on 2026-07-26
-- with: pg_dump --schema=public --schema-only --no-owner --no-privileges --no-comments
--
-- This is the source of truth for the schema. The three files under
-- supabase/legacy/ are historical: they describe a schema production does not
-- actually have. Notably discount_codes here has a uuid `id` primary key and
-- the discount_type/current_uses/show_on_banner columns the app really uses,
-- none of which appear in legacy/schema.sql.
--
-- Production has been recorded as already having this schema via:
--   node scripts/migrate.mjs baseline --env prod --version 0001_baseline --yes
--
-- Every change from here on is a NEW numbered migration applied to both
-- databases through scripts/migrate.mjs. Editing this file after it has been
-- applied is a checksum error, by design.
--

--
-- PostgreSQL database dump
--

-- (psql meta-command removed: not executable over a plain connection)

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;  -- PG17+ only; omitted for portability
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
-- SET row_security = off;  -- requires superuser; not needed for a schema load

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: increment_code_usage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_code_usage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  update discount_codes
  set current_uses = coalesce(current_uses, 0) + 1
  where id = new.code_id;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: doctor_pricing_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_pricing_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    override_type text NOT NULL,
    discount_percentage integer,
    discount_amount integer,
    custom_monthly_price integer,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date,
    reason text NOT NULL,
    category text DEFAULT 'manual'::text,
    created_by text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT doctor_pricing_overrides_category_check CHECK ((category = ANY (ARRAY['founding_member'::text, 'staff_family'::text, 'referral_reward'::text, 'trial'::text, 'promotional'::text, 'partnership'::text, 'manual'::text]))),
    CONSTRAINT doctor_pricing_overrides_discount_percentage_check CHECK (((discount_percentage >= 0) AND (discount_percentage <= 100))),
    CONSTRAINT doctor_pricing_overrides_override_type_check CHECK ((override_type = ANY (ARRAY['free'::text, 'discount_pct'::text, 'discount_fixed'::text, 'custom_price'::text, 'trial'::text])))
);


--
-- Name: doctors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    qualification text,
    reg_number text,
    speciality text,
    clinic_name text,
    address text,
    pin_codes text[],
    phone text,
    email text,
    consultation_fee integer DEFAULT 0,
    working_hours text,
    photo_url text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    is_hospital_doctor boolean DEFAULT false,
    discount_code text,
    discount_applied integer,
    CONSTRAINT doctors_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text])))
);


--
-- Name: pricing_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier_number integer NOT NULL,
    tier_name text NOT NULL,
    min_population integer DEFAULT 0 NOT NULL,
    max_population integer NOT NULL,
    monthly_price integer NOT NULL,
    premium_slot_1_weekly integer NOT NULL,
    premium_slot_2_weekly integer NOT NULL,
    premium_slot_3_weekly integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: service_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pin_code text NOT NULL,
    area_name text NOT NULL,
    district text NOT NULL,
    state text NOT NULL,
    tier_number integer,
    population integer,
    is_active boolean DEFAULT true,
    launch_date date DEFAULT CURRENT_DATE,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: doctor_effective_pricing; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.doctor_effective_pricing AS
 SELECT d.id AS doctor_id,
    d.name,
    d.pin_codes,
    COALESCE(sum(pt.monthly_price), (0)::bigint) AS base_monthly_price,
    dpo.override_type,
    dpo.discount_percentage,
    dpo.discount_amount,
    dpo.custom_monthly_price,
    dpo.valid_until,
    dpo.reason,
    dpo.category,
        CASE
            WHEN (dpo.override_type = 'free'::text) THEN (0)::numeric
            WHEN (dpo.override_type = 'discount_pct'::text) THEN round(((COALESCE(sum(pt.monthly_price), (0)::bigint))::numeric * ((1)::numeric - ((dpo.discount_percentage)::numeric / (100)::numeric))))
            WHEN (dpo.override_type = 'discount_fixed'::text) THEN (GREATEST((0)::bigint, (COALESCE(sum(pt.monthly_price), (0)::bigint) - dpo.discount_amount)))::numeric
            WHEN (dpo.override_type = 'custom_price'::text) THEN (dpo.custom_monthly_price)::numeric
            WHEN (dpo.override_type = 'trial'::text) THEN (0)::numeric
            ELSE (COALESCE(sum(pt.monthly_price), (0)::bigint))::numeric
        END AS effective_monthly_price,
        CASE
            WHEN (dpo.override_type = ANY (ARRAY['free'::text, 'trial'::text])) THEN true
            WHEN ((dpo.override_type = 'discount_pct'::text) AND (dpo.discount_percentage = 100)) THEN true
            ELSE false
        END AS is_free,
    dpo.is_active AS has_override
   FROM (((public.doctors d
     LEFT JOIN public.service_areas sa ON (((sa.pin_code = ANY (d.pin_codes)) AND (sa.is_active = true))))
     LEFT JOIN public.pricing_tiers pt ON ((pt.tier_number = sa.tier_number)))
     LEFT JOIN public.doctor_pricing_overrides dpo ON (((dpo.doctor_id = d.id) AND (dpo.is_active = true) AND ((dpo.valid_until IS NULL) OR (dpo.valid_until >= CURRENT_DATE)))))
  GROUP BY d.id, d.name, d.pin_codes, dpo.override_type, dpo.discount_percentage, dpo.discount_amount, dpo.custom_monthly_price, dpo.valid_until, dpo.reason, dpo.category, dpo.is_active;


--
-- Name: admin_revenue_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_revenue_summary AS
 SELECT d.name AS doctor_name,
    d.status,
    dep.base_monthly_price,
    dep.effective_monthly_price,
    ((dep.base_monthly_price)::numeric - dep.effective_monthly_price) AS discount_amount,
        CASE
            WHEN dep.is_free THEN 'FREE'::text
            WHEN (dep.override_type = 'discount_pct'::text) THEN (dep.discount_percentage || '% off'::text)
            WHEN (dep.override_type = 'discount_fixed'::text) THEN (('₹'::text || dep.discount_amount) || ' off'::text)
            WHEN (dep.override_type = 'custom_price'::text) THEN ('Custom: ₹'::text || dep.custom_monthly_price)
            ELSE 'Full price'::text
        END AS pricing_label,
    dep.category AS override_category,
    dep.valid_until AS discount_expires
   FROM (public.doctors d
     LEFT JOIN public.doctor_effective_pricing dep ON ((dep.doctor_id = d.id)))
  WHERE (d.status = 'active'::text)
  ORDER BY dep.effective_monthly_price DESC;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_phone text,
    patient_name text,
    patient_age integer,
    doctor_id uuid,
    slot_datetime timestamp with time zone,
    status text DEFAULT 'booked'::text,
    booked_via text DEFAULT 'whatsapp_bot'::text,
    confirmation_sent boolean DEFAULT false,
    reminder_sent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT appointments_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: camps_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.camps_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    camp_type text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    services_offered text,
    date_from date NOT NULL,
    date_to date NOT NULL,
    time_slot text,
    pin_codes text[] NOT NULL,
    status text DEFAULT 'pending_approval'::text,
    admin_notes text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    CONSTRAINT camps_offers_camp_type_check CHECK ((camp_type = ANY (ARRAY['free_camp'::text, 'special_offer'::text]))),
    CONSTRAINT camps_offers_status_check CHECK ((status = ANY (ARRAY['pending_approval'::text, 'approved'::text, 'rejected'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: clinic_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinic_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    full_name text NOT NULL,
    email text,
    whatsapp_number text NOT NULL,
    role text NOT NULL,
    notify_new_appointments boolean DEFAULT true,
    notify_daily_schedule boolean DEFAULT true,
    notify_cancellations boolean DEFAULT true,
    notify_monthly_report boolean DEFAULT false,
    can_login_web boolean DEFAULT true,
    supabase_user_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    CONSTRAINT clinic_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'doctor'::text, 'receptionist'::text, 'manager'::text])))
);


--
-- Name: discount_code_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_code_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code_id uuid,
    doctor_id uuid,
    discount_applied integer,
    used_at timestamp with time zone DEFAULT now()
);


--
-- Name: discount_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    discount_type text NOT NULL,
    discount_value integer NOT NULL,
    applies_to text DEFAULT 'first_payment'::text,
    duration_months integer,
    max_uses integer,
    current_uses integer DEFAULT 0,
    valid_from date DEFAULT CURRENT_DATE,
    valid_until date,
    restricted_to_tier integer[],
    is_active boolean DEFAULT true,
    created_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    show_on_banner boolean DEFAULT false,
    banner_text_en text,
    banner_text_hi text,
    CONSTRAINT discount_codes_applies_to_check CHECK ((applies_to = ANY (ARRAY['first_payment'::text, 'ongoing'::text, 'first_n_months'::text]))),
    CONSTRAINT discount_codes_discount_type_check CHECK ((discount_type = ANY (ARRAY['percentage'::text, 'fixed_amount'::text, 'free_months'::text])))
);


--
-- Name: doctor_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    slot_duration_minutes integer DEFAULT 15 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT doctor_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: free_camp_quota; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.free_camp_quota AS
 SELECT doctor_id,
    date_trunc('quarter'::text, (date_from)::timestamp with time zone) AS quarter,
    count(*) AS camps_used
   FROM public.camps_offers
  WHERE ((camp_type = 'free_camp'::text) AND (status = ANY (ARRAY['approved'::text, 'completed'::text])))
  GROUP BY doctor_id, (date_trunc('quarter'::text, (date_from)::timestamp with time zone));


--
-- Name: offer_quota; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.offer_quota AS
 SELECT doctor_id,
    date_trunc('month'::text, (date_from)::timestamp with time zone) AS month,
    count(*) AS offers_used
   FROM public.camps_offers
  WHERE ((camp_type = 'special_offer'::text) AND (status = ANY (ARRAY['approved'::text, 'completed'::text])))
  GROUP BY doctor_id, (date_trunc('month'::text, (date_from)::timestamp with time zone));


--
-- Name: opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opt_outs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_hash text NOT NULL,
    opted_out_at timestamp with time zone DEFAULT now(),
    channel text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: org_specialities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_specialities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    speciality text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: org_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    speciality text NOT NULL,
    pin_code text NOT NULL,
    monthly_price integer,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT org_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'hospital'::text,
    registration_number text,
    address text,
    phone text,
    email text,
    logo_url text,
    website text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text]))),
    CONSTRAINT organizations_type_check CHECK ((type = ANY (ARRAY['hospital'::text, 'clinic_group'::text, 'chain'::text])))
);


--
-- Name: patient_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_hash text NOT NULL,
    name text,
    age integer,
    pin_code text,
    referral_code text,
    referred_by text,
    family_card boolean DEFAULT false,
    family_card_expiry date,
    badge text DEFAULT 'Sehat Starter'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    amount integer,
    type text,
    razorpay_payment_id text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text]))),
    CONSTRAINT payments_type_check CHECK ((type = ANY (ARRAY['subscription'::text, 'premium_slot'::text])))
);


--
-- Name: premium_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    pin_code text,
    speciality text,
    "position" integer,
    week_start date,
    week_end date,
    price integer,
    status text DEFAULT 'booked'::text,
    razorpay_payment_id text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT premium_slots_position_check CHECK (("position" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT premium_slots_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'available'::text, 'expired'::text])))
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid,
    doctor_id uuid NOT NULL,
    patient_phone_hash text,
    overall_rating integer NOT NULL,
    waiting_time text,
    communication text,
    value_for_money text,
    review_text text,
    is_visible boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ratings_communication_check CHECK ((communication = ANY (ARRAY['good'::text, 'ok'::text, 'bad'::text]))),
    CONSTRAINT ratings_overall_rating_check CHECK (((overall_rating >= 1) AND (overall_rating <= 5))),
    CONSTRAINT ratings_value_for_money_check CHECK ((value_for_money = ANY (ARRAY['good'::text, 'ok'::text, 'bad'::text]))),
    CONSTRAINT ratings_waiting_time_check CHECK ((waiting_time = ANY (ARRAY['good'::text, 'ok'::text, 'bad'::text])))
);


--
-- Name: rating_aggregate; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rating_aggregate AS
 SELECT doctor_id,
    round(avg(overall_rating), 1) AS avg_rating,
    count(*) AS total_reviews,
    count(*) FILTER (WHERE (created_at >= (now() - '90 days'::interval))) AS reviews_last_90_days,
    round(avg(overall_rating) FILTER (WHERE (created_at >= (now() - '90 days'::interval))), 1) AS avg_rating_last_90_days,
    ((avg(overall_rating) >= 4.5) AND (count(*) >= 10)) AS is_top_rated,
    max(created_at) AS last_updated
   FROM public.ratings
  WHERE (is_visible = true)
  GROUP BY doctor_id;


--
-- Name: rating_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rating_id uuid,
    doctor_id uuid,
    response_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid,
    referred_phone_hash text,
    status text DEFAULT 'pending'::text,
    reward_points integer DEFAULT 200,
    reward_given boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: review_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rating_id uuid,
    reason text,
    flagged_by text,
    resolved boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT review_flags_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'fake'::text, 'abusive'::text, 'other'::text])))
);


--
-- Name: rewards_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rewards_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid,
    points_used integer,
    reward_type text,
    reward_value text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sehat_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sehat_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid,
    points integer NOT NULL,
    action text,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: site_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    approx_location text,
    latitude numeric,
    longitude numeric,
    page_visited text,
    speciality_clicked text,
    doctor_clicked text,
    referrer text,
    device_type text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid,
    pin_codes text[],
    base_fee integer,
    start_date date,
    end_date date,
    status text DEFAULT 'active'::text,
    razorpay_subscription_id text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: unmet_demand_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unmet_demand_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    pin_code text,
    speciality text,
    patient_wants_notification boolean DEFAULT false,
    patient_phone_hash text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT unmet_demand_log_source_check CHECK ((source = ANY (ARRAY['bot'::text, 'website'::text])))
);


--
-- Name: unmet_demand_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.unmet_demand_summary AS
 SELECT speciality,
    pin_code,
    count(*) AS request_count,
    count(*) FILTER (WHERE patient_wants_notification) AS wants_notification_count,
    max(created_at) AS most_recent_request
   FROM public.unmet_demand_log
  GROUP BY speciality, pin_code
  ORDER BY (count(*)) DESC;


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: camps_offers camps_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camps_offers
    ADD CONSTRAINT camps_offers_pkey PRIMARY KEY (id);


--
-- Name: clinic_users clinic_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_users
    ADD CONSTRAINT clinic_users_pkey PRIMARY KEY (id);


--
-- Name: clinic_users clinic_users_supabase_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_users
    ADD CONSTRAINT clinic_users_supabase_user_id_key UNIQUE (supabase_user_id);


--
-- Name: discount_code_usage discount_code_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_code_usage
    ADD CONSTRAINT discount_code_usage_pkey PRIMARY KEY (id);


--
-- Name: discount_codes discount_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_codes
    ADD CONSTRAINT discount_codes_code_key UNIQUE (code);


--
-- Name: discount_codes discount_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_codes
    ADD CONSTRAINT discount_codes_pkey PRIMARY KEY (id);


--
-- Name: doctor_availability doctor_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_availability
    ADD CONSTRAINT doctor_availability_pkey PRIMARY KEY (id);


--
-- Name: doctor_pricing_overrides doctor_pricing_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_pricing_overrides
    ADD CONSTRAINT doctor_pricing_overrides_pkey PRIMARY KEY (id);


--
-- Name: doctors doctors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_pkey PRIMARY KEY (id);


--
-- Name: opt_outs opt_outs_phone_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_phone_hash_key UNIQUE (phone_hash);


--
-- Name: opt_outs opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_pkey PRIMARY KEY (id);


--
-- Name: org_specialities org_specialities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_specialities
    ADD CONSTRAINT org_specialities_pkey PRIMARY KEY (id);


--
-- Name: org_subscriptions org_subscriptions_organization_id_speciality_pin_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_subscriptions
    ADD CONSTRAINT org_subscriptions_organization_id_speciality_pin_code_key UNIQUE (organization_id, speciality, pin_code);


--
-- Name: org_subscriptions org_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_subscriptions
    ADD CONSTRAINT org_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: patient_profiles patient_profiles_phone_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_phone_hash_key UNIQUE (phone_hash);


--
-- Name: patient_profiles patient_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_pkey PRIMARY KEY (id);


--
-- Name: patient_profiles patient_profiles_referral_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_referral_code_key UNIQUE (referral_code);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: premium_slots premium_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_slots
    ADD CONSTRAINT premium_slots_pkey PRIMARY KEY (id);


--
-- Name: pricing_tiers pricing_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_tiers
    ADD CONSTRAINT pricing_tiers_pkey PRIMARY KEY (id);


--
-- Name: pricing_tiers pricing_tiers_tier_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_tiers
    ADD CONSTRAINT pricing_tiers_tier_number_key UNIQUE (tier_number);


--
-- Name: rating_responses rating_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_responses
    ADD CONSTRAINT rating_responses_pkey PRIMARY KEY (id);


--
-- Name: ratings ratings_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_appointment_id_key UNIQUE (appointment_id);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: review_flags review_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_pkey PRIMARY KEY (id);


--
-- Name: rewards_redemptions rewards_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards_redemptions
    ADD CONSTRAINT rewards_redemptions_pkey PRIMARY KEY (id);


--
-- Name: sehat_points sehat_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sehat_points
    ADD CONSTRAINT sehat_points_pkey PRIMARY KEY (id);


--
-- Name: service_areas service_areas_pin_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_areas
    ADD CONSTRAINT service_areas_pin_code_key UNIQUE (pin_code);


--
-- Name: service_areas service_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_areas
    ADD CONSTRAINT service_areas_pkey PRIMARY KEY (id);


--
-- Name: site_visits site_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_visits
    ADD CONSTRAINT site_visits_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: unmet_demand_log unmet_demand_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unmet_demand_log
    ADD CONSTRAINT unmet_demand_log_pkey PRIMARY KEY (id);


--
-- Name: idx_areas_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_areas_active ON public.service_areas USING btree (is_active);


--
-- Name: idx_areas_district; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_areas_district ON public.service_areas USING btree (district, state);


--
-- Name: idx_areas_pin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_areas_pin ON public.service_areas USING btree (pin_code);


--
-- Name: idx_areas_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_areas_tier ON public.service_areas USING btree (tier_number);


--
-- Name: idx_availability_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_availability_day ON public.doctor_availability USING btree (day_of_week);


--
-- Name: idx_availability_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_availability_doctor ON public.doctor_availability USING btree (doctor_id);


--
-- Name: idx_camps_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camps_dates ON public.camps_offers USING btree (date_from, date_to);


--
-- Name: idx_camps_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camps_doctor ON public.camps_offers USING btree (doctor_id);


--
-- Name: idx_camps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camps_status ON public.camps_offers USING btree (status);


--
-- Name: idx_clinic_users_auth; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clinic_users_auth ON public.clinic_users USING btree (supabase_user_id);


--
-- Name: idx_clinic_users_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clinic_users_doctor ON public.clinic_users USING btree (doctor_id);


--
-- Name: idx_demand_pin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demand_pin ON public.unmet_demand_log USING btree (pin_code);


--
-- Name: idx_demand_speciality; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demand_speciality ON public.unmet_demand_log USING btree (speciality);


--
-- Name: idx_doctors_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_org ON public.doctors USING btree (organization_id);


--
-- Name: idx_no_double_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_no_double_booking ON public.appointments USING btree (doctor_id, slot_datetime) WHERE (status <> 'cancelled'::text);


--
-- Name: idx_org_specialities_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_specialities_org ON public.org_specialities USING btree (organization_id);


--
-- Name: idx_org_subs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_subs_org ON public.org_subscriptions USING btree (organization_id);


--
-- Name: idx_orgs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_status ON public.organizations USING btree (status);


--
-- Name: idx_overrides_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_overrides_active ON public.doctor_pricing_overrides USING btree (is_active, valid_until);


--
-- Name: idx_overrides_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_overrides_doctor ON public.doctor_pricing_overrides USING btree (doctor_id);


--
-- Name: idx_ratings_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_doctor ON public.ratings USING btree (doctor_id);


--
-- Name: idx_ratings_visible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_visible ON public.ratings USING btree (is_visible);


--
-- Name: idx_visits_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_date ON public.site_visits USING btree (created_at);


--
-- Name: idx_visits_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_location ON public.site_visits USING btree (approx_location);


--
-- Name: idx_visits_speciality; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_speciality ON public.site_visits USING btree (speciality_clicked);


--
-- Name: discount_code_usage trg_increment_code_usage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_increment_code_usage AFTER INSERT ON public.discount_code_usage FOR EACH ROW EXECUTE FUNCTION public.increment_code_usage();


--
-- Name: appointments appointments_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: camps_offers camps_offers_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camps_offers
    ADD CONSTRAINT camps_offers_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: camps_offers camps_offers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camps_offers
    ADD CONSTRAINT camps_offers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: clinic_users clinic_users_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_users
    ADD CONSTRAINT clinic_users_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: clinic_users clinic_users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_users
    ADD CONSTRAINT clinic_users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: discount_code_usage discount_code_usage_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_code_usage
    ADD CONSTRAINT discount_code_usage_code_id_fkey FOREIGN KEY (code_id) REFERENCES public.discount_codes(id);


--
-- Name: discount_code_usage discount_code_usage_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_code_usage
    ADD CONSTRAINT discount_code_usage_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: doctor_availability doctor_availability_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_availability
    ADD CONSTRAINT doctor_availability_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: doctor_pricing_overrides doctor_pricing_overrides_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_pricing_overrides
    ADD CONSTRAINT doctor_pricing_overrides_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: doctors doctors_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: org_specialities org_specialities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_specialities
    ADD CONSTRAINT org_specialities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_subscriptions org_subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_subscriptions
    ADD CONSTRAINT org_subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: payments payments_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: premium_slots premium_slots_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_slots
    ADD CONSTRAINT premium_slots_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: rating_responses rating_responses_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_responses
    ADD CONSTRAINT rating_responses_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: rating_responses rating_responses_rating_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_responses
    ADD CONSTRAINT rating_responses_rating_id_fkey FOREIGN KEY (rating_id) REFERENCES public.ratings(id) ON DELETE CASCADE;


--
-- Name: ratings ratings_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: ratings ratings_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: referrals referrals_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.patient_profiles(id);


--
-- Name: review_flags review_flags_rating_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_rating_id_fkey FOREIGN KEY (rating_id) REFERENCES public.ratings(id) ON DELETE CASCADE;


--
-- Name: rewards_redemptions rewards_redemptions_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards_redemptions
    ADD CONSTRAINT rewards_redemptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patient_profiles(id);


--
-- Name: sehat_points sehat_points_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sehat_points
    ADD CONSTRAINT sehat_points_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patient_profiles(id);


--
-- Name: service_areas service_areas_tier_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_areas
    ADD CONSTRAINT service_areas_tier_number_fkey FOREIGN KEY (tier_number) REFERENCES public.pricing_tiers(tier_number);


--
-- Name: subscriptions subscriptions_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;


--
-- Name: appointments allow_insert_appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_appointments ON public.appointments FOR INSERT WITH CHECK (true);


--
-- Name: discount_code_usage allow_insert_code_usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_code_usage ON public.discount_code_usage FOR INSERT WITH CHECK (true);


--
-- Name: unmet_demand_log allow_insert_demand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_demand ON public.unmet_demand_log FOR INSERT WITH CHECK (true);


--
-- Name: doctors allow_insert_doctors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_doctors ON public.doctors FOR INSERT WITH CHECK (true);


--
-- Name: review_flags allow_insert_flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_flags ON public.review_flags FOR INSERT WITH CHECK (true);


--
-- Name: opt_outs allow_insert_optouts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_optouts ON public.opt_outs FOR INSERT WITH CHECK (true);


--
-- Name: ratings allow_insert_ratings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_ratings ON public.ratings FOR INSERT WITH CHECK (true);


--
-- Name: site_visits allow_insert_visits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_visits ON public.site_visits FOR INSERT WITH CHECK (true);


--
-- Name: doctors allow_read_active_doctors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_read_active_doctors ON public.doctors FOR SELECT USING ((status = 'active'::text));


--
-- Name: opt_outs allow_read_optouts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_read_optouts ON public.opt_outs FOR SELECT USING (true);


--
-- Name: discount_codes allow_write_coupons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_write_coupons ON public.discount_codes USING (true) WITH CHECK (true);


--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: camps_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.camps_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments clinic_staff_read_appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clinic_staff_read_appointments ON public.appointments FOR SELECT USING ((doctor_id IN ( SELECT clinic_users.doctor_id
   FROM public.clinic_users
  WHERE ((clinic_users.supabase_user_id = auth.uid()) AND (clinic_users.is_active = true)))));


--
-- Name: appointments clinic_staff_update_appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clinic_staff_update_appointments ON public.appointments FOR UPDATE USING ((doctor_id IN ( SELECT clinic_users.doctor_id
   FROM public.clinic_users
  WHERE ((clinic_users.supabase_user_id = auth.uid()) AND (clinic_users.role = ANY (ARRAY['owner'::text, 'receptionist'::text, 'manager'::text])) AND (clinic_users.is_active = true)))));


--
-- Name: clinic_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_code_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_code_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_availability doctor_manages_own_availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctor_manages_own_availability ON public.doctor_availability USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: doctor_pricing_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doctor_pricing_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: doctors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

--
-- Name: camps_offers doctors_insert_own_camps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_insert_own_camps ON public.camps_offers FOR INSERT WITH CHECK ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: rating_responses doctors_insert_own_responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_insert_own_responses ON public.rating_responses FOR INSERT WITH CHECK ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: doctors doctors_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_read_own ON public.doctors FOR SELECT USING (((auth.jwt() ->> 'email'::text) = email));


--
-- Name: appointments doctors_read_own_appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_read_own_appointments ON public.appointments FOR SELECT USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: camps_offers doctors_read_own_camps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_read_own_camps ON public.camps_offers FOR SELECT USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: discount_code_usage doctors_read_own_code_usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_read_own_code_usage ON public.discount_code_usage FOR SELECT USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: ratings doctors_read_own_ratings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_read_own_ratings ON public.ratings FOR SELECT USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: doctors doctors_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_update_own ON public.doctors FOR UPDATE USING (((auth.jwt() ->> 'email'::text) = email));


--
-- Name: appointments doctors_update_own_appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctors_update_own_appointments ON public.appointments FOR UPDATE USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: opt_outs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opt_outs ENABLE ROW LEVEL SECURITY;

--
-- Name: org_specialities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_specialities ENABLE ROW LEVEL SECURITY;

--
-- Name: org_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: clinic_users owner_manages_own_clinic_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_manages_own_clinic_users ON public.clinic_users USING ((doctor_id IN ( SELECT doctors.id
   FROM public.doctors
  WHERE (doctors.email = (auth.jwt() ->> 'email'::text)))));


--
-- Name: patient_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: premium_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.premium_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_codes public_read_active_codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_active_codes ON public.discount_codes FOR SELECT USING (((is_active = true) AND ((valid_from IS NULL) OR (valid_from <= CURRENT_DATE)) AND ((valid_until IS NULL) OR (valid_until >= CURRENT_DATE))));


--
-- Name: org_specialities public_read_active_org_specialities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_active_org_specialities ON public.org_specialities FOR SELECT USING (((is_active = true) AND (organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE (organizations.status = 'active'::text)))));


--
-- Name: organizations public_read_active_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_active_orgs ON public.organizations FOR SELECT USING ((status = 'active'::text));


--
-- Name: camps_offers public_read_approved_camps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_approved_camps ON public.camps_offers FOR SELECT USING (((status = 'approved'::text) AND (date_to >= CURRENT_DATE)));


--
-- Name: service_areas public_read_areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_areas ON public.service_areas FOR SELECT USING ((is_active = true));


--
-- Name: doctor_availability public_read_availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_availability ON public.doctor_availability FOR SELECT USING (true);


--
-- Name: rating_responses public_read_responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_responses ON public.rating_responses FOR SELECT USING ((rating_id IN ( SELECT ratings.id
   FROM public.ratings
  WHERE (ratings.is_visible = true))));


--
-- Name: pricing_tiers public_read_tiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_tiers ON public.pricing_tiers FOR SELECT USING ((is_active = true));


--
-- Name: ratings public_read_visible_ratings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_visible_ratings ON public.ratings FOR SELECT USING ((is_visible = true));


--
-- Name: rating_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rating_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

--
-- Name: referrals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: review_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: rewards_redemptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rewards_redemptions ENABLE ROW LEVEL SECURITY;

--
-- Name: sehat_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sehat_points ENABLE ROW LEVEL SECURITY;

--
-- Name: service_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: site_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_availability staff_manages_clinic_availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_manages_clinic_availability ON public.doctor_availability USING ((doctor_id IN ( SELECT clinic_users.doctor_id
   FROM public.clinic_users
  WHERE ((clinic_users.supabase_user_id = auth.uid()) AND (clinic_users.role = ANY (ARRAY['owner'::text, 'receptionist'::text, 'manager'::text])) AND (clinic_users.is_active = true)))));


--
-- Name: clinic_users staff_reads_own_membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_reads_own_membership ON public.clinic_users FOR SELECT USING ((supabase_user_id = auth.uid()));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: unmet_demand_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unmet_demand_log ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

-- (psql meta-command removed: not executable over a plain connection)

