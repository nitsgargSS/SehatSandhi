import { notFound } from 'next/navigation';

import type { Lang } from '@/lib/sehat';

import { type Ctx, load } from './ctx';

// Shared by every page route: check the language and load the clinic.

export type Params = { key: string; lang: string };

export async function ctxFor(params: Params): Promise<Ctx> {
  if (params.lang !== 'en' && params.lang !== 'hi') notFound();
  return load(params.key, params.lang as Lang);
}
