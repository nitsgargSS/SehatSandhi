-- ============================================================================
-- 0315 — International: health and travel articles that rotate on the portal
-- ============================================================================
-- AFTER 0314. Safe to re-run.
--
-- Asked 3 Nov 2026: no social media posts for International; instead articles
-- on the portal — important health topics and guides for patients coming from
-- abroad — that keep rotating (the home page shows a different few each day).
--
--   intl_articles   slug, title, summary, body (the small Markdown the site
--                   renderer reads: ## headings, paragraphs, - lists, **bold**,
--                   [links](https://…)), category, related procedure, status.
--   status          draft → review → published. A health article is published
--                   only with the name of the doctor who reviewed it
--                   (reviewed_by); the database refuses otherwise.
--   sehat_intl_articles()        published list for the portal (no bodies)
--   sehat_intl_article(slug)     one published article, and +1 view
--   image_url       optional banner photo; without one the banner uses the
--                   category's colour and icon.
-- The 12 seeded articles start in 'review': an admin publishes each after a
-- doctor has read it.
-- ============================================================================

create table if not exists intl_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  summary text not null,
  body text not null,
  category text not null check (category in ('planning', 'treatment', 'health')),
  procedure_code text references intl_procedures(code),
  read_minutes integer not null default 3,
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  reviewed_by text,
  reviewed_at date,
  published_at timestamptz,
  featured boolean not null default false,
  image_url text check (image_url is null or image_url ~ '^https://'),
  views integer not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (status <> 'published' or category = 'planning' or coalesce(btrim(reviewed_by), '') <> '')
);

alter table intl_articles enable row level security;
drop policy if exists intl_articles_admin on intl_articles;
create policy intl_articles_admin on intl_articles for all to authenticated using (sehat_is_admin()) with check (sehat_is_admin());
revoke all on intl_articles from anon;
grant select, insert, update, delete on intl_articles to authenticated;

create or replace function sehat_intl_article_stamp()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then new.published_at := coalesce(new.published_at, now()); end if;
  new.read_minutes := greatest(1, ceil(array_length(regexp_split_to_array(btrim(new.body), '\s+'), 1) / 200.0));
  return new;
end $$;
drop trigger if exists intl_article_stamp on intl_articles;
create trigger intl_article_stamp before insert or update on intl_articles for each row execute function sehat_intl_article_stamp();

create or replace function sehat_intl_articles()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'title', title, 'summary', summary, 'category', category, 'procedure_code', procedure_code,
    'read_minutes', read_minutes, 'reviewed_by', reviewed_by, 'reviewed_at', reviewed_at, 'published_at', published_at,
    'featured', featured, 'image_url', image_url, 'updated_at', updated_at) order by featured desc, published_at desc), '[]'::jsonb)
  from intl_articles where status = 'published'
$$;

create or replace function sehat_intl_article(p_slug text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a intl_articles;
begin
  update intl_articles set views = views + 1 where slug = p_slug and status = 'published' returning * into a;
  if a.id is null then return null; end if;
  return jsonb_build_object('slug', a.slug, 'title', a.title, 'summary', a.summary, 'body', a.body, 'category', a.category,
    'procedure_code', a.procedure_code, 'read_minutes', a.read_minutes, 'reviewed_by', a.reviewed_by, 'reviewed_at', a.reviewed_at,
    'published_at', a.published_at, 'updated_at', a.updated_at, 'image_url', a.image_url);
end $$;
revoke all on function sehat_intl_articles() from public;
revoke all on function sehat_intl_article(text) from public;
grant execute on function sehat_intl_articles(), sehat_intl_article(text) to anon, authenticated;

-- ── Seed (status 'review': published by an admin after a doctor reads them) ─
insert into intl_articles (slug, title, summary, category, procedure_code, status, body) values
('planning-treatment-in-india-step-by-step', 'Planning treatment in India: a step-by-step guide',
 'From your first message to your follow-ups at home — what happens, in what order, and how long each step usually takes.',
 'planning', null, 'review', $md$
Coming to another country for treatment feels like a big step. It is easier when you know the order things happen in. Here is the usual path.

## 1. Share your reports

Start with your most recent reports, scans and the list of medicines you take. A clear phone photo of each page is enough. Doctors need these to tell you whether the treatment is right for you and to give a real quote.

## 2. Compare and choose

You receive written opinions and quotes from the hospitals you shortlisted, usually within two days. Each quote should say what is included, how many days you stay in hospital, and how long you should stay in India. Ask questions until you are comfortable. **The choice is always yours.**

## 3. Visa letter and visa

Once you accept a quote, the hospital issues an invitation letter through the government's visa portal. You then apply online for an e-Medical visa. Up to two family members can travel with you on attendant visas.

## 4. Travel

Share your flight details. You are met at the airport and taken to your hotel or straight to the hospital.

## 5. Treatment and recovery

Tests are repeated on arrival and the surgeon explains the plan before you sign anything. After treatment you stay near the hospital until your doctor says you are fit to fly.

## 6. Home, with follow-up

You leave with an English discharge summary, copies of every report, and dates for online follow-ups. Show the summary to your own doctor at home.

**Tip:** keep one folder — paper or on your phone — with your passport, visa, quote, reports and receipts. It makes every step easier.
$md$),
('e-medical-visa-explained', 'The e-Medical visa for India, explained simply',
 'Who needs it, what you need before applying, how family members come with you, and the mistakes that cause delays.',
 'planning', null, 'review', $md$
Most patients coming to India for treatment use the **e-Medical visa**. It is applied for online, and you do not need to visit an embassy.

## Before you apply

- A passport valid for at least six months from the date you arrive
- The **invitation letter** from your Indian hospital. The hospital issues it through the government's Medical and Ayush Visa Portal after you accept its quote.
- A recent photo and a scan of your passport's photo page

## Family members

Up to two people can come with you on **e-Medical Attendant** visas. Each applies separately and is linked to your application.

## Who does not need one

Citizens of **Nepal and Bhutan** do not need a visa for India. **OCI card holders** (Overseas Citizens of India) also travel without a visa.

## Avoid these delays

- Apply only on the official Indian government visa website. Other websites that look official charge extra fees.
- Make sure your name is spelt exactly as in your passport — on the visa, the hospital letter and your ticket.
- Apply early. Leave at least a week before your flight.

## When you arrive

The hospital registers your stay with the immigration office (FRRO), as the law requires. You only need to show your passport and visa.

Visa rules can change, so always check the official website for your country before applying. Your coordinator can help if anything is unclear.
$md$),
('how-to-choose-a-hospital-nabh-jci', 'How to choose a hospital: what NABH and JCI really mean',
 'Accreditation, ICU, the doctor''s experience and the questions worth asking — a simple checklist for comparing hospitals.',
 'planning', null, 'review', $md$
Price matters, but it should never be the only thing you compare. These are the checks that matter most.

## Accreditation

**NABH** is India's national hospital accreditation. Hospitals are inspected against hundreds of standards for safety, infection control and patient rights. "Entry-level" NABH is a first step; full accreditation is more demanding. **JCI** is an international accreditation held by a smaller number of large hospitals.

Accreditation does not guarantee a result, but it tells you the hospital is inspected regularly by people outside it.

## Questions worth asking

- How many of this procedure does the surgeon do in a year?
- Does the hospital have its own ICU, open 24 hours, in case of a complication?
- Is there a doctor on site at night?
- What exactly is included in the price — implant, medicines, physiotherapy, follow-ups?
- What happens, and who pays, if I need to stay longer?
- Who is my contact person, and do they answer on WhatsApp?

## City size

For many routine planned procedures, good hospitals in smaller cities do the same treatment every day, often at a lower total cost. For complex or rare treatment, larger centres usually have more experience. Ask your doctor what suits your case.

## A good sign

A hospital that answers your questions clearly, in writing, before you travel, usually looks after you well when you arrive.
$md$),
('understanding-your-estimate', 'Understanding your estimate: what is included and what is not',
 'Why estimates change, the costs people forget to ask about, and how to protect yourself from surprises.',
 'planning', null, 'review', $md$
An estimate is the hospital's best guess before a doctor has examined you. Knowing what it covers helps you avoid surprises.

## Usually included

- The surgeon's and anaesthetist's fees
- Operation theatre charges
- The room for the stated number of days
- Routine medicines and tests during your stay

## Often not included — ask

- **Implants and lenses:** Indian and imported options can differ a lot in price
- **Extra days** in hospital, or days in the ICU
- **Blood** if you need it
- Treatment for **another condition** found during tests
- Your **companion's** bed and food
- **Follow-ups** after you go home

## Why a price can change

Tests on arrival can show something new — for example high blood sugar that needs control before surgery. If the plan changes, the hospital should tell you **in writing, with the reason, before** doing any extra paid work. Only an emergency is an exception.

## Protect yourself

- Get the final quote in writing before treatment
- Keep every receipt
- Ask for an itemised final bill in English
- Never pay cash to anyone who is not the hospital's billing desk
$md$),
('flying-after-surgery', 'Flying home after surgery: what to know',
 'When it is usually safe to fly, how to lower the risk of blood clots, and what to carry on the plane.',
 'health', null, 'review', $md$
Your treating doctor decides when you are fit to fly. That decision depends on the operation, how you recover and the length of the flight. These are general points to discuss with your doctor.

## Why doctors ask you to wait

After surgery, the body needs time for wounds to seal and for swelling to settle. Long flights also mean sitting still for hours, which raises the risk of **blood clots in the legs** (deep vein thrombosis). The risk is higher after leg, hip and abdominal surgery.

## Lowering the risk

- Walk around the cabin every hour or two if you can
- Move your feet and ankles while seated
- Drink water; avoid alcohol
- Wear compression stockings if your doctor advises them
- Take blood-thinning medicine only exactly as prescribed

## Carry on the plane

- Your **fit-to-fly note** and discharge summary
- Medicines in your hand luggage, with the prescription
- A wheelchair request made with the airline in advance, if you need one

## After eye surgery

Some eye operations involve a gas bubble inside the eye. **Flying is unsafe until the gas has gone.** Always ask your eye surgeon before booking.

## When to get help

Pain or swelling in one leg, sudden breathlessness or chest pain during or after a flight needs urgent medical care.
$md$),
('knee-replacement-what-to-expect', 'Knee replacement: what to expect, from surgery to walking again',
 'How long you stay, when physiotherapy starts, and how to prepare your home before you return.',
 'treatment', 'knee_replacement', 'review', $md$
Knee replacement is one of the most common planned operations for people travelling for treatment. It replaces the worn surfaces of the knee joint with an implant.

## Before you travel

Send a recent standing X-ray of the knee, blood tests, an ECG and your list of medicines. Tell the doctor about diabetes, heart problems and any blood-thinning medicines — some must be stopped before surgery, but only on a doctor's instructions.

## In hospital

Most patients stand with support on the first or second day. **Physiotherapy starts early** and continues every day. A typical hospital stay is a few days, but your surgeon decides.

## The weeks after

Plan to stay in India for around two to three weeks, so the wound can be checked and stitches or clips removed, and physiotherapy continued. Walking aids are usually needed for a few weeks.

## Prepare your home

- Clear loose rugs and cables
- A firm chair with arms
- Things you use daily within easy reach
- A raised toilet seat if your surgeon suggests one

## Questions to ask

- Which implant is included, and what are the options?
- How many days of physiotherapy are in the price?
- When can I fly, and what precautions should I take?

Recovery is gradual. Following the exercise plan at home makes the biggest difference to the result.
$md$),
('cataract-surgery-guide', 'Cataract surgery: lens choices and recovery',
 'What happens on the day, the kinds of lens, and when you can usually travel home.',
 'treatment', 'cataract', 'review', $md$
A cataract is a clouding of the eye's natural lens. Surgery replaces it with a clear artificial lens. It is usually a day procedure.

## Lens choices

- **Monofocal** lenses give clear vision at one distance. Most people still need reading glasses.
- **Toric** lenses also correct astigmatism.
- **Multifocal or extended-range** lenses aim to reduce the need for glasses at more than one distance. They do not suit every eye.

Your surgeon recommends a lens after examining your eye. Indian and imported lenses are both available, at different prices; ask what your quote includes.

## On the day

Eye drops numb the eye. The operation itself usually takes less than half an hour, and you go home the same day with a shield over the eye.

## Recovery

- Use the drops exactly as prescribed
- Avoid rubbing the eye, swimming and dusty places for the time your doctor advises
- Attend the check-up the next day and the follow-up visits

Many patients fly home a few days after surgery, once the doctor has checked the eye. Your surgeon confirms the date.

## Get help quickly if

You have increasing pain, worsening vision, or a lot of redness after the first days.
$md$),
('dental-implants-one-trip-or-two', 'Dental implants: one trip or two?',
 'How implant treatment is staged, why some people need two visits, and how to plan your time.',
 'treatment', 'dental_implant', 'review', $md$
A dental implant is a small titanium post placed in the jaw. It holds a crown that looks and works like a tooth.

## Why timing matters

The implant needs time to join with the bone before the final crown is fitted. Depending on your bone and the dentist's plan, this can be:

- **Two visits:** the implant is placed on the first trip; the final crown is fitted on a second trip a few months later
- **One longer visit:** in some cases a temporary crown is fitted straight away, with the final crown later
- **Bone grafting first,** if there is not enough bone, which adds time

## Before you travel

Send a recent dental X-ray or 3D scan (CBCT) if you have one, photos of your teeth and your medical history. This lets the dentist plan the number of visits before you book flights.

## What affects healing

Smoking, uncontrolled diabetes and gum disease all slow healing. Tell your dentist about them.

## Questions to ask

- How many visits will I need, and how long is each?
- Is the crown included, and what is it made of?
- What happens if an implant does not settle?

Good daily cleaning and regular check-ups at home help implants last.
$md$),
('heart-stents-and-angioplasty', 'Angioplasty and stents: what patients should know',
 'What the procedure involves, the tests doctors need first, and life after a stent.',
 'treatment', 'angioplasty', 'review', $md$
Angioplasty opens a narrowed heart artery using a small balloon. A **stent** — a tiny mesh tube — is usually left in place to keep the artery open.

## Is it the right treatment?

Not every narrowing needs a stent. The decision depends on your symptoms, test results and which arteries are affected. Some people do better with medicines alone, others with bypass surgery. Send your **angiography report or CD**, echo and ECG so the cardiologist can advise.

## The procedure

It is done through an artery in the wrist or groin, usually under local anaesthetic. Most patients stay in hospital for a short time and are encouraged to walk soon after.

## After a stent

- **Blood-thinning medicines** are essential. Never stop them without your cardiologist's advice, even for dental work.
- Carry your stent card and discharge summary
- A heart-healthy diet, regular activity and stopping smoking protect your arteries

## In India

Coronary stent prices in India are capped by the government's drug pricing authority, so the cost of the stent itself is regulated.

## Urgent symptoms

Chest pain, breathlessness or fainting need emergency care immediately — wherever you are.
$md$),
('diabetes-and-surgery', 'Diabetes and planned surgery: how to prepare',
 'Why blood sugar control matters before an operation, and what to bring and ask before you travel.',
 'health', null, 'review', $md$
Many people travelling for surgery also have diabetes. Good preparation makes surgery safer and recovery smoother.

## Why it matters

High blood sugar slows wound healing and raises the risk of infection. Surgeons often check **HbA1c** (your average sugar over about three months). If it is too high, they may ask you to improve control before a planned operation.

## Before you travel

- Get a recent HbA1c and kidney function test and send them with your reports
- Bring a written list of all your diabetes medicines and doses
- Bring enough medicine and testing supplies for the whole trip, plus extra
- Carry insulin in your hand luggage, with your prescription

## Around the operation

Your doctors may change your medicines on the day before and the day of surgery. **Follow their instructions only** — do not adjust doses yourself.

## After surgery

- Check your sugar more often than usual for a while
- Watch your wound for redness, swelling or discharge
- Keep your follow-up appointments

## Talk to your doctor

If your sugar has been hard to control, say so early. A short delay to improve it is better than a complication.
$md$),
('travelling-with-a-companion', 'Travelling with a companion: a practical guide',
 'Visas for family, where they stay, and how a companion can help most during your treatment.',
 'planning', null, 'review', $md$
A family member or friend at your side makes treatment abroad much easier. Here is how to plan for them.

## Visas

Up to two companions can come on **e-Medical Attendant** visas, linked to the patient's e-Medical visa. Citizens of Nepal and Bhutan and OCI card holders do not need a visa.

## Where they stay

Many hospitals let one companion stay in the patient's room, often on a sofa-bed. Others stay in a hotel near the hospital. Ask whether your quote includes the companion's bed and food — usually it does not.

## How a companion helps most

- Keep the folder of documents, receipts and medicines
- Listen to the doctor's instructions with you and write them down
- Help with walking and daily care after surgery
- Stay in touch with your coordinator and family at home

## Look after the companion too

Caring for someone is tiring. Plan rest, regular meals and some time outside the hospital. A local SIM card helps them stay in touch.

## Before you leave home

Make sure your companion has their own travel insurance, enough of any medicines they take, and copies of your key documents.
$md$),
('follow-up-after-you-go-home', 'Recovering at home: follow-up after treatment abroad',
 'What to take home, how online follow-ups work, and when to see a doctor locally.',
 'health', null, 'review', $md$
Your care does not end when you leave India. A good plan for home is part of good treatment.

## Take home

- An **English discharge summary** that names the operation, implants used and medicines
- Copies of all reports and scans, digital and printed
- A clear medicine plan: names, doses and for how long
- The dates of your online follow-ups

## Online follow-ups

Your treating doctor reviews your progress by video call on the dates in your quote. Send photos of the wound or new reports before the call if asked.

## Your local doctor

Visit your own doctor soon after you return and show them the discharge summary. They can check your wound, adjust medicines and arrange physiotherapy or tests near home.

## Get help urgently if you notice

- Fever, or a wound that becomes red, hot, swollen or leaks
- Pain or swelling in one leg
- Breathlessness or chest pain
- Any sudden change after eye surgery

## Keep your records

Keep the discharge summary safe. Any future doctor, anywhere in the world, will want to see it.
$md$)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
