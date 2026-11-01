'use client';

import { useState } from 'react';

import { SEHAT_KEY, SEHAT_URL } from '@/lib/sehat';

// One form component for every message the site sends to Sehatsandhi (0304):
// Contact us, the international patient questionnaire, and questions for the
// doctor. Each lands in the clinic's Website → Messages inbox and is emailed
// to the clinic. A hidden "website" field catches bots.

type B = { en: string; hi: string };
type Lang = 'en' | 'hi';

export type Field = {
  name: string;
  label: B;
  type?: 'text' | 'tel' | 'email' | 'textarea' | 'select' | 'date' | 'number' | 'checkbox';
  options?: { value: string; label: B }[];
  required?: boolean;
  placeholder?: B;
  hint?: B;
  /** Half width on wide screens. */
  half?: boolean;
};

/** Fields stored in their own columns; everything else goes into `details`. */
const COLUMNS = ['name', 'phone', 'email', 'country', 'message'];

export default function SiteForm({ siteKey, lang, kind, fields, submit, done, extra, initial }: {
  /** The clinic's site key (business_sites slug or domain). */
  siteKey: string;
  lang: Lang;
  kind: 'contact' | 'international' | 'question';
  fields: Field[];
  submit: B;
  done: B;
  /** Fixed details sent with every message (e.g. the subject). */
  extra?: Record<string, string>;
  /** Starting values (e.g. the question already typed). */
  initial?: Record<string, string>;
}) {
  const t = (x: B) => x[lang];
  const [values, setValues] = useState<Record<string, string | boolean>>(initial ?? {});
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const set = (k: string, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr('');
    const missing = fields.find((f) => f.required && !String(values[f.name] ?? '').trim());
    if (missing) { setErr(lang === 'hi' ? `कृपया भरें: ${t(missing.label)}` : `Please fill in: ${t(missing.label)}`); return; }
    const details: Record<string, string | boolean> = { ...(extra ?? {}) };
    for (const f of fields) if (!COLUMNS.includes(f.name) && values[f.name] !== undefined && values[f.name] !== '') details[f.name] = values[f.name];
    setState('sending');
    try {
      const r = await fetch(`${SEHAT_URL}/rest/v1/rpc/sehat_site_message`, {
        method: 'POST',
        headers: { apikey: SEHAT_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_key: siteKey, p_kind: kind, p_message: String(values.message ?? ''),
          p_name: values.name || null, p_phone: values.phone || null, p_email: values.email || null,
          p_country: values.country || null, p_details: details, p_lang: lang,
          p_page: window.location.pathname, p_website: String(values.website ?? ''),
        }),
      });
      const res = r.ok ? await r.json() : null;
      if (!res?.ok) { setState('idle'); setErr(res?.error || (lang === 'hi' ? 'भेज नहीं पाए। कृपया कॉल या WhatsApp करें।' : 'Could not send. Please call or WhatsApp us.')); return; }
      setState('sent');
    } catch {
      setState('idle');
      setErr(lang === 'hi' ? 'भेज नहीं पाए। कृपया कॉल या WhatsApp करें।' : 'Could not send. Please call or WhatsApp us.');
    }
  };

  if (state === 'sent') {
    return <div className="note-ok" role="status"><span>{t(done)}</span></div>;
  }

  return (
    <form className="siteform" onSubmit={send} noValidate>
      {fields.map((f) => {
        const id = `sf-${kind}-${f.name}`;
        const common = { id, name: f.name, required: f.required, placeholder: f.placeholder ? t(f.placeholder) : undefined };
        if (f.type === 'checkbox') {
          return (
            <label key={f.name} className="sf-check" htmlFor={id}>
              <input {...common} type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
              <span>{t(f.label)}</span>
            </label>
          );
        }
        return (
          <div key={f.name} className={`sf-field${f.half ? ' sf-half' : ''}`}>
            <label htmlFor={id}>{t(f.label)}{f.required && <span aria-hidden className="sf-req"> *</span>}</label>
            {f.type === 'textarea' ? (
              <textarea {...common} rows={5} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} />
            ) : f.type === 'select' ? (
              <select {...common} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">{lang === 'hi' ? 'चुनें' : 'Choose'}</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
            ) : (
              <input {...common} type={f.type ?? 'text'} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)}
                autoComplete={f.name === 'name' ? 'name' : f.name === 'phone' ? 'tel' : f.name === 'email' ? 'email' : f.name === 'country' ? 'country-name' : undefined} />
            )}
            {f.hint && <span className="sf-hint">{t(f.hint)}</span>}
          </div>
        );
      })}
      <div className="sf-trap" aria-hidden>
        <label htmlFor={`sf-${kind}-website`}>Website</label>
        <input id={`sf-${kind}-website`} name="website" tabIndex={-1} autoComplete="off" value={String(values.website ?? '')} onChange={(e) => set('website', e.target.value)} />
      </div>
      {err && <p className="field-err" role="alert">{err}</p>}
      <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>{state === 'sending' ? (lang === 'hi' ? 'भेज रहे हैं…' : 'Sending…') : t(submit)}</button>
    </form>
  );
}
