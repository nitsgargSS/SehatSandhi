import { BusinessDoctor } from '../lib/doctorsApi'

// One dropdown for "which doctor", used wherever a record is created for a
// doctor (token, registration, admission, charge) and wherever a list is
// filtered by one. `allLabel` adds a first option meaning "no one in
// particular" — "All doctors" for a filter, "Not assigned" for a record.
export default function DoctorSelect({ doctors, value, onChange, allLabel, style, className }: {
  doctors: BusinessDoctor[]
  value: string | null
  onChange: (practitionerId: string | null) => void
  allLabel?: string
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={style} className={className}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {doctors.map(d => (
        <option key={d.practitioner_id} value={d.practitioner_id}>
          {d.full_name}{d.speciality ? ` · ${d.speciality}` : ''}
        </option>
      ))}
    </select>
  )
}
