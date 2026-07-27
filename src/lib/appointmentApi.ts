import { supabase } from './supabase'
import { activeConfig } from './env'

// Changing an appointment.
//
// These call database functions rather than updating the row directly, because
// the functions add what an UPDATE can't: a slot-clash check before a
// reschedule, and consistent timestamps. Authorisation is unchanged — the
// functions run under the caller's RLS, so a clinic can only touch its own
// appointments.
//
// The audit trail and the patient notification are written by a trigger, not by
// this file. That is deliberate: a caller cannot forget to notify, because a
// caller never notifies.

export type AppointmentActor = 'patient' | 'clinic' | 'admin' | 'system'

/** Nudge the outbox so the patient hears now rather than on the next sweep. */
async function drainNotifications(appointmentId: string) {
  const { url, anon } = activeConfig()
  if (!url || !anon) return
  try {
    await fetch(`${url}/functions/v1/appointment-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      body: JSON.stringify({ appointmentId }),
    })
  } catch {
    // Queued either way — the scheduled drain will pick it up.
  }
}

export async function cancelAppointment(
  appointmentId: string, reason: string, actor: AppointmentActor = 'clinic', actorDetail?: string,
) {
  const { error } = await supabase.rpc('sehat_cancel_appointment', {
    p_appointment_id: appointmentId,
    p_actor: actor,
    p_reason: reason || null,
    p_actor_detail: actorDetail ?? null,
  })
  if (error) throw new Error(error.message)
  await drainNotifications(appointmentId)
}

export async function rescheduleAppointment(
  appointmentId: string, newSlotIso: string, reason?: string,
  actor: AppointmentActor = 'clinic', actorDetail?: string,
) {
  const { error } = await supabase.rpc('sehat_reschedule_appointment', {
    p_appointment_id: appointmentId,
    p_new_slot: newSlotIso,
    p_actor: actor,
    p_reason: reason ?? null,
    p_actor_detail: actorDetail ?? null,
  })
  // The clash guard surfaces as a plain message rather than a Postgres error.
  if (error) throw new Error(error.message.includes('already taken')
    ? 'That slot is already booked. Please pick another time.'
    : error.message)
  await drainNotifications(appointmentId)
}

export async function setAppointmentStatus(
  appointmentId: string, status: 'booked' | 'confirmed' | 'completed' | 'no_show',
  actor: AppointmentActor = 'clinic', actorDetail?: string,
) {
  const { error } = await supabase.rpc('sehat_set_appointment_status', {
    p_appointment_id: appointmentId,
    p_status: status,
    p_actor: actor,
    p_actor_detail: actorDetail ?? null,
  })
  if (error) throw new Error(error.message)
  await drainNotifications(appointmentId)
}
