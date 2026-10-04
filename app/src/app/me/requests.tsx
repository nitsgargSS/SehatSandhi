import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { myActivity, type Activity } from '../../lib/patient'
import { RateList, RequestList, requests, toRate } from '../../ui/MyLists'
import { Err } from '../../ui/kit'
import { withPatient } from '../../ui/PatientGate'

// Everything on the patient's number: what waits for a rating, then every
// booking, order and request — the full lists behind My Sehatsandhi's 'See all'.
function RequestsScreen() {
  const [act, setAct] = useState<Activity | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { myActivity().then(setAct).catch(e => setErr((e as Error).message)) }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))
  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Err msg={err} />
      <RateList items={toRate(act)} />
      <RequestList items={requests(act)} onChanged={load} />
    </ScrollView>
  )
}

const st = StyleSheet.create({ wrap: { padding: 16, gap: 12, paddingBottom: 40 } })

export default withPatient(RequestsScreen, 'These are the bookings and requests on your number.')
