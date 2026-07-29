// URLs for the patient-facing pages.
//
// These exist because nothing generated them. /speciality/:specId/:areaSlug and
// /doctor/:slug were real, built pages — ratings, multi-location clinics,
// reviews, schema.org markup — with zero inbound links anywhere in the app and
// no sitemap. The only way to reach either was to type the URL by hand, so in
// practice patients never saw them, and the impression/view/tap events the
// clinic Reports are built on fired on pages nobody visited.
//
// Both halves of a link (build and resolve) live here so they cannot drift: the
// resolver used to own a private slugify, which meant the format was defined in
// exactly one place and used in exactly one direction.

/**
 * Lowercase, and anything that is not a letter or digit becomes a hyphen.
 *
 * Must match on both sides of a URL. The old version only collapsed whitespace,
 * so a clinic called "[TEST] Kaur Clinic" produced /doctor/[test]-kaur-clinic —
 * brackets and all, which a browser then percent-encodes into something nobody
 * can read or retype. Real names carry commas, full stops and apostrophes
 * ("Dr. R.K. Gupta & Sons"); all of them belong out of the path.
 */
export const slugify = (s: string): string =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')   // punctuation and spaces alike
    .replace(/^-+|-+$/g, '')        // no leading or trailing hyphen
    || 'listing'                    // a name of pure punctuation still needs a path

/** Search results for one speciality in one area. */
export const specialityUrl = (specialityId: string, area: string): string =>
  `/speciality/${specialityId}/${slugify(area)}`

/**
 * A single listing's public profile.
 *
 * The id goes last because the resolver drops the final segment and matches the
 * rest against the name — so the id is what keeps two similarly-named clinics
 * apart in the URL, even though the current resolver throws it away. Passing it
 * now means the links are already right when that resolver is fixed to look up
 * by id rather than by fuzzy name match.
 */
export const doctorUrl = (doctor: { id: string; name: string }): string =>
  `/doctor/${slugify(doctor.name)}-${doctor.id.slice(0, 8)}`
