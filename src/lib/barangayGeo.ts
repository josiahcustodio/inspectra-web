// [REF: BARANGAY_GEO]
//
// Barangay boundaries for Batangas City, plus the name matching that ties a
// stored establishment record to one of them.
//
// The GIS map aggregates at barangay level (pins exist only for the few
// establishments with coordinates, see models.ts): every establishment carries
// a barangay chosen from a fixed list. Boundaries are real PSA/PSGC 2019 polygons, not
// drawn approximations — see ATTRIBUTIONS.md.

import boundaries from "@/lib/data/batangas_barangays.geojson.json";
import type { Establishment } from "./models";

export interface BarangayFeatureProps {
  name: string;
  pcode: string;
}

export const BARANGAY_BOUNDARIES = boundaries as unknown as GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  BarangayFeatureProps
>;

/// The 105 official barangay names, in the exact spelling the polygons use.
export const BARANGAY_NAMES: string[] = BARANGAY_BOUNDARIES.features
  .map((f) => f.properties.name)
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

// Roughly the centre of Batangas City — the map's home view.
export const CITY_CENTER: [number, number] = [13.76, 121.055];

/// Saint abbreviations, expanded so "Sta. Clara" meets the boundary set's
/// "Santa Clara". Applied to both sides of every comparison (the boundary
/// names go through this function too), so the two can only ever agree. No
/// barangay in the official 105 contains "sta" or "sto" as a whole word in any
/// other sense, which is what makes this safe to do by rule.
const SAINT_WORDS: Record<string, string> = { sta: "santa", sto: "santo" };

/// Strip everything that varies between how a name is stored and how the
/// boundary set spells it: case, diacritics, the "(Pob.)" suffix on the
/// numbered poblacion barangays, the ", Batangas City" / ", Isla Verde"
/// qualifier that follows the first comma, and any punctuation. Saint
/// abbreviations are expanded last, once the punctuation is gone.
export function normalizeBarangay(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/,.*$/, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => SAINT_WORDS[word] ?? word)
    .join(" ");
}

/// The barangay as text, with the city/province tail removed \u2014 "Alangilan,
/// Batangas City" becomes "Alangilan". Used only as the fallback when a value
/// resolves to no boundary at all, so that even an unmappable record is stored
/// without the noise every row repeats.
export function barangayWithoutCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const head = raw.split(",")[0].trim();
  return head === "" ? null : head;
}

// [REF: BARANGAY_ALIASES]
// Spellings that appear in stored records (they come from the dropdown list in
// batangas_psgc.json) but differ from the official boundary names by more than
// punctuation. Keys are normalized; values are the canonical boundary name.
//
// "Talon" is deliberately absent: it is in the dropdown but has no boundary in
// the official set, and no neighbouring barangay is a defensible substitute.
// Establishments saved under it are reported as unmapped rather than silently
// attributed to the wrong place.
const BARANGAY_ALIASES: Record<string, string> = {
  "banaba east": "Banaba Silangan",
  "banaba west": "Banaba Kanluran",
  "banaba south": "Banaba Ibaba",
  bucal: "Bukal",
  dumuclay: "Domoclay",
  ilijan: "Ilihan",
  "gulod labac": "Gulod Labak",
  "tingga itaas": "Tinga Itaas",
  "tingga labac": "Tinga Labak",
  liponpon: "Liponpon, Isla Verde",
  mabacong: "Mabacong (Matoco)",
  matoco: "Mabacong (Matoco)",
  "tabangao proper": "Tabangao Aplaya (Tabangao Proper)",

  // ── Spellings the city's own masterlist uses ──────────────────────────
  // Added from an audit of the real 2026 food and non-food workbooks, with
  // the row count each one accounted for. Every entry below is a C/K or
  // vowel difference against the boundary set's spelling, not a judgement:
  // the city writes "Carsada", the boundaries say "Karsada".
  "santa rita carsada": "Santa Rita Karsada", // 46 rows
  "sorosoro carsada": "Sorosoro Karsada", //      7 rows
  "tinga labac": "Tinga Labak", //              107 rows
  "conde labac": "Conde Labak", //               23 rows
  domuclay: "Domoclay", //                       18 rows
  "mahakot kanluran": "Mahacot Kanluran", //      1 row
  "mahakot silangan": "Mahacot Silangan", //      (the pair, for symmetry)
  maapaz: "Maapas", //                            1 row
  // The boundary name carries the island as a comma qualifier, which
  // normalizeBarangay strips — so the island spelled without the comma needs
  // saying explicitly.
  "san agapito isla verde": "San Agapito, Isla Verde", // 2 rows
  "san agustin kanluran isla verde": "San Agustin Kanluran, Isla Verde",
  "san agustin silangan isla verde": "San Agustin Silangan, Isla Verde",
  "san andres isla verde": "San Andres, Isla Verde",
  "san antonio isla verde": "San Antonio, Isla Verde",

  // "<name> Proper" is how the masterlist writes the centre barangay of a
  // cluster, the same convention the boundary set spells out in
  // "Tabangao Aplaya (Tabangao Proper)". Both of these have an unsuffixed
  // boundary alongside their Ibaba/Silangan/Pulot siblings, so the centre is
  // the only reading available — but it IS a reading, so confirm it with the
  // sanitation office rather than treating it as established.
  "pinamucan proper": "Pinamucan", //            36 rows
  "dela paz proper": "Dela Paz", //              19 rows
};

const BY_NORMALIZED = new Map<string, string>(
  BARANGAY_BOUNDARIES.features.map((f) => [normalizeBarangay(f.properties.name), f.properties.name]),
);

/// Resolve a stored barangay string to the boundary name it refers to, or null
/// when it matches no boundary. Null is a real answer here — it drives the
/// "unmapped" notice on the map rather than being swallowed.
/// The numbered town-centre barangays, which the two sources name completely
/// differently: the boundary set calls them "Barangay 22 (Pob.)" while the
/// city's masterlist writes "Poblacion 022". Matched by rule rather than by 24
/// alias entries, since the number is the whole identity — leading zeros are
/// dropped, and the spelling of the word is not trusted beyond its first six
/// letters, which is what lets the "Poblacio 009" typo in the real file through
/// to the right place. Nothing resolves unless the resulting "barangay N" is a
/// real boundary, so "Poblacion 099" still comes back unmapped.
const POBLACION_PATTERN = /^(?:poblaci\w*|brgy|bgy)\s*0*(\d+)$/;

/// One normalised key -> official name: alias, then the numbered-poblacion
/// rule, then the boundary set itself. Shared by the whole-value path and the
/// address walk below, so "Poblacion 022" resolves wherever it appears.
function resolveKey(key: string): string | null {
  const alias = BARANGAY_ALIASES[key];
  if (alias) return alias;
  const poblacion = POBLACION_PATTERN.exec(key);
  if (poblacion) return BY_NORMALIZED.get(`barangay ${Number(poblacion[1])}`) ?? null;
  return BY_NORMALIZED.get(key) ?? null;
}

export function canonicalBarangay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalizeBarangay(raw);
  if (!key) return null;

  const direct = resolveKey(key);
  if (direct) return direct;

  // Last resort: the value is a whole address rather than a barangay, with the
  // barangay buried in it — "Duluhan, Cuta, Batangas City" names a sitio first.
  // normalizeBarangay keeps only the text before the first comma, so those
  // never reach a boundary. Walk the comma-separated parts instead and take the
  // LAST one that resolves, because an address runs narrow to broad: street,
  // sitio, barangay, city. Taking the last match is what stops "San Pedro
  // Street, Alangilan" resolving to the San Pedro barangay.
  //
  // This runs only after every rule above has failed, so it cannot change the
  // answer for any value that already resolved.
  const parts = raw.split(",");
  if (parts.length > 1) {
    let found: string | null = null;
    for (const part of parts) {
      const partKey = normalizeBarangay(part);
      if (!partKey) continue;
      const hit = resolveKey(partKey);
      if (hit) found = hit;
    }
    if (found) return found;
  }

  return null;
}

/// Where an establishment's barangay actually lives on the record. Newer records
/// have the dedicated `barangay` field, records written by AddEstablishmentModal
/// also carry a structured `address` object, and the oldest ones kept the whole
/// address as a plain string. Same resolution order Dashboard.tsx uses.
export function barangayOfEstablishment(est: Establishment): string | null {
  if (est.barangay) return est.barangay;
  const addr = est.address as any;
  if (addr && typeof addr === "object" && addr.barangay) return addr.barangay as string;
  if (typeof addr === "string" && addr) return addr;
  return null;
}
