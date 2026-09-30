// [REF: BARANGAY_GEO]
//
// Barangay boundaries for Batangas City, plus the name matching that ties a
// stored establishment record to one of them.
//
// The GIS map works at barangay level rather than plotting individual
// establishments: no client writes latitude/longitude (see the note on
// Establishment in models.ts), but every establishment carries a barangay
// chosen from a fixed list. Boundaries are real PSA/PSGC 2019 polygons, not
// drawn approximations — see ATTRIBUTIONS.md.

import boundaries from "./data/batangas_barangays.geojson.json";
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

/// Strip everything that varies between how a name is stored and how the
/// boundary set spells it: case, diacritics, the "(Pob.)" suffix on the
/// numbered poblacion barangays, the ", Isla Verde" island qualifier, and any
/// punctuation.
export function normalizeBarangay(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/,.*$/, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
};

const BY_NORMALIZED = new Map<string, string>(
  BARANGAY_BOUNDARIES.features.map((f) => [normalizeBarangay(f.properties.name), f.properties.name]),
);

/// Resolve a stored barangay string to the boundary name it refers to, or null
/// when it matches no boundary. Null is a real answer here — it drives the
/// "unmapped" notice on the map rather than being swallowed.
export function canonicalBarangay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalizeBarangay(raw);
  if (!key) return null;
  const alias = BARANGAY_ALIASES[key];
  if (alias) return alias;
  return BY_NORMALIZED.get(key) ?? null;
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
