// Shared slot-generation logic. Takes a doctor's weekly
// availability template + their already-booked appointments,
// and produces the actual list of open/taken slots for a
// specific date. Used by the doctor's own schedule preview now,
// and will be reused by the in-app booking screen and — once
// built — the WhatsApp bot, so all three channels always agree
// on what's actually available.

import { supabase } from './supabase'

export interface AvailabilityTemplate {
  id: string
  doctor_id: string
  location_id?: string | null
  day_of_week: number // 0=Sunday ... 6=Saturday, matches JS Date.getDay()
  start_time: string  // "10:00:00"
  end_time: string    // "18:00:00"
  slot_duration_minutes: number
  /** Patients the window holds. At 60 minutes, patients per hour. */
  slot_capacity: number
  is_active: boolean
}

export interface TimeSlot {
  time: string       // "10:00 AM" — for display
  datetime: string   // full ISO datetime — for booking/comparison
  available: boolean
  seatsLeft?: number
  capacity?: number
  locationId?: string | null
  locationName?: string | null
}

/**
 * Bookable windows from the server, with seats left.
 *
 * Preferred over generateSlotsForDate: sehat_open_windows is the same source the
 * capacity trigger enforces against, so what is offered and what is accepted
 * cannot disagree. It also knows about locations, which the local template
 * version cannot see.
 */
export async function fetchOpenWindows(doctorId: string, date: Date): Promise<TimeSlot[]> {
  const { data, error } = await supabase.rpc('sehat_open_windows', {
    p_doctor_id: doctorId,
    p_date: date.toISOString().slice(0, 10),
  })
  if (error || !data) return []
  return (data as {
    location_id: string | null; location_name: string | null
    window_start: string; capacity: number; booked: number; seats_left: number
  }[]).map(w => ({
    time: new Date(w.window_start).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    }),
    datetime: w.window_start,
    available: w.seats_left > 0,
    seatsLeft: w.seats_left,
    capacity: w.capacity,
    locationId: w.location_id,
    locationName: w.location_name,
  }))
}

export function generateSlotsForDate(
  templates: AvailabilityTemplate[],
  targetDate: Date,
  bookedDatetimes: string[]
): TimeSlot[] {
  const dayOfWeek = targetDate.getDay()
  const dayTemplates = templates.filter(t => t.day_of_week === dayOfWeek && t.is_active)

  // Count per window, not a presence set. One booking used to mark a window
  // taken, which was right when a slot held one patient and wrong the moment
  // capacity existed — a 12-1 hour holding three would have shut after the first.
  const bookedCounts = new Map<number, number>()
  for (const b of bookedDatetimes) {
    const t = new Date(b).getTime()
    bookedCounts.set(t, (bookedCounts.get(t) ?? 0) + 1)
  }

  const slots: TimeSlot[] = []

  for (const template of dayTemplates) {
    const [startH, startM] = template.start_time.split(':').map(Number)
    const [endH, endM] = template.end_time.split(':').map(Number)

    const current = new Date(targetDate)
    current.setHours(startH, startM, 0, 0)

    const end = new Date(targetDate)
    end.setHours(endH, endM, 0, 0)

    while (current < end) {
      const capacity = template.slot_capacity ?? 1
      const taken = bookedCounts.get(current.getTime()) ?? 0
      slots.push({
        time: current.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        datetime: current.toISOString(),
        available: taken < capacity,
        seatsLeft: Math.max(0, capacity - taken),
        capacity,
        locationId: template.location_id ?? null,
      })
      current.setTime(current.getTime() + template.slot_duration_minutes * 60000)
    }
  }

  return slots.sort((a, b) => a.datetime.localeCompare(b.datetime))
}

export const DAYS_OF_WEEK = [
  { value: 1, labelEn: 'Monday', labelHi: 'Somvar' },
  { value: 2, labelEn: 'Tuesday', labelHi: 'Mangalvar' },
  { value: 3, labelEn: 'Wednesday', labelHi: 'Budhvar' },
  { value: 4, labelEn: 'Thursday', labelHi: 'Guruvar' },
  { value: 5, labelEn: 'Friday', labelHi: 'Shukravar' },
  { value: 6, labelEn: 'Saturday', labelHi: 'Shanivar' },
  { value: 0, labelEn: 'Sunday', labelHi: 'Ravivar' },
]
