// Shared slot-generation logic. Takes a doctor's weekly
// availability template + their already-booked appointments,
// and produces the actual list of open/taken slots for a
// specific date. Used by the doctor's own schedule preview now,
// and will be reused by the in-app booking screen and — once
// built — the WhatsApp bot, so all three channels always agree
// on what's actually available.

export interface AvailabilityTemplate {
  id: string
  doctor_id: string
  day_of_week: number // 0=Sunday ... 6=Saturday, matches JS Date.getDay()
  start_time: string  // "10:00:00"
  end_time: string    // "18:00:00"
  slot_duration_minutes: number
  is_active: boolean
}

export interface TimeSlot {
  time: string       // "10:00 AM" — for display
  datetime: string   // full ISO datetime — for booking/comparison
  available: boolean
}

export function generateSlotsForDate(
  templates: AvailabilityTemplate[],
  targetDate: Date,
  bookedDatetimes: string[]
): TimeSlot[] {
  const dayOfWeek = targetDate.getDay()
  const dayTemplates = templates.filter(t => t.day_of_week === dayOfWeek && t.is_active)

  const bookedTimes = new Set(
    bookedDatetimes.map(b => new Date(b).getTime())
  )

  const slots: TimeSlot[] = []

  for (const template of dayTemplates) {
    const [startH, startM] = template.start_time.split(':').map(Number)
    const [endH, endM] = template.end_time.split(':').map(Number)

    const current = new Date(targetDate)
    current.setHours(startH, startM, 0, 0)

    const end = new Date(targetDate)
    end.setHours(endH, endM, 0, 0)

    while (current < end) {
      slots.push({
        time: current.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        datetime: current.toISOString(),
        available: !bookedTimes.has(current.getTime()),
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
