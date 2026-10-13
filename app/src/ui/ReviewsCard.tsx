import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { Card, Label, Note } from './kit'
import { C } from './theme'

// What patients said about this clinic — the website dashboard's "Patient
// reviews", on the phone. No name or number is kept with a review; the clinic
// cannot edit or remove one.
interface Review { id: string; overall_rating: number; review_text: string | null; created_at: string }
const when = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function ReviewsCard({ biz }: { biz: string }) {
  const [rows, setRows] = useState<Review[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    supabase.from('ratings').select('id, overall_rating, review_text, created_at')
      .eq('business_id', biz).eq('is_visible', true).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setRows((data ?? []) as Review[]))
  }, [biz])
  if (!rows) return null
  const n = rows.length
  const avg = n ? rows.reduce((a, r) => a + r.overall_rating, 0) / n : 0
  return (
    <Card>
      <Label>Patient reviews</Label>
      {n === 0 ? <Note>No reviews yet. Patients can rate you from the Review QR at your clinic, or after a visit.</Note> : (
        <>
          <Text style={st.big}>★ {avg.toFixed(1)} <Text style={st.meta}>from {n} review{n === 1 ? '' : 's'}</Text></Text>
          {(all ? rows : rows.slice(0, 5)).map(r => (
            <View key={r.id} style={st.row}>
              <View style={st.head}>
                <Text style={st.stars}>{'★'.repeat(r.overall_rating)}<Text style={{ color: '#d8d2c4' }}>{'★'.repeat(5 - r.overall_rating)}</Text></Text>
                <Text style={st.meta}>{when(r.created_at)}</Text>
              </View>
              <Text style={r.review_text ? st.body : st.meta}>{r.review_text ? `“${r.review_text}”` : 'Rated without writing a review.'}</Text>
            </View>
          ))}
          {n > 5 && <Text style={st.link} onPress={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${n}`}</Text>}
        </>
      )}
    </Card>
  )
}

const st = StyleSheet.create({
  big: { fontSize: 18, fontWeight: '800', color: C.ink },
  row: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 8, gap: 3 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stars: { color: '#e0a100', fontSize: 15 },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted, fontWeight: '400' },
  link: { color: C.green, fontWeight: '700', paddingTop: 4 },
})
