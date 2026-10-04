import { supabase } from './supabase'

// 0197: messages between a clinic and its patients — the clinic's side, shared
// by the website and the app. A patient writes from the Sehatsandhi app; staff
// answer here. Only numbers on the clinic's register can be messaged.

export interface Thread { phone: string; names: string | null; last_body: string | null; last_from: 'patient' | 'clinic' | null; last_at: string; unread: number; on_app: boolean }
export interface Message { id: number; from: 'patient' | 'clinic'; by: string | null; body: string; photo_url: string | null; at: string; read: boolean }

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const listThreads = (businessId: string) => rpc<Thread[]>('sehat_clinic_threads', { p_business: businessId }).then(r => r ?? [])
export const openThread = (businessId: string, phone: string) =>
  rpc<{ on_app: boolean; registered: boolean; messages: Message[] }>('sehat_clinic_thread', { p_business: businessId, p_phone: phone })
export const sendToPatient = (businessId: string, phone: string, body: string) =>
  rpc<Message>('sehat_clinic_send', { p_business: businessId, p_phone: phone, p_body: body })
export const unreadCount = (businessId: string) => rpc<number>('sehat_clinic_unread', { p_business: businessId }).then(n => n ?? 0)
