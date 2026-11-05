import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Layers, Search, AlertTriangle, ChevronLeft, Crosshair } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useCollection } from "@/lib/useCollection";
import { COLLECTIONS, mapEstablishment, mapInspectionLog } from "@/lib/firestore";
import {
  BARANGAY_BOUNDARIES,
  BARANGAY_NAMES,
  CITY_CENTER,
  barangayOfEstablishment,
  canonicalBarangay,
  normalizeBarangay,
} from "@/lib/barangayGeo";
import { byNewestFirst, relativeInspectionAge } from "@/lib/inspectionDates";
import {
  PASSING_SCORE,
  RATING_BANDS,
  UNSCORED_COLOR,
  UNSCORED_LABEL,
  colorOfBand,
  ratingBand,
  ratingColor,
} from "@/lib/ratingScale";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// [REF: GIS_BARANGAY_MODEL]
//
// The map aggregates at barangay level: every establishment carries a
// barangay, and the boundaries are real PSA/PSGC polygons, so click or search
// one and its compliance breakdown appears on the right. Establishments that
// also carry latitude/longitude (seeded or set by the admin) get a pin on top
// of the polygons ([REF: GIS_PINS]); most records still have none.

/// One establishment as listed under its barangay. `score` is null when the
/// establishment has never been inspected — that is a distinct state from a
/// score of zero, and the two are counted separately below.
interface EstablishmentRow {
  id: string;
  name: string;
  score: number | null;
  inspector: string | null;
  lastInspected: string;
}

/// [REF: RATING_SCALE]
/// The three buckets are the shared rating bands, so a barangay's breakdown
/// reads the same way it does on the dashboard and in the mobile app.
interface BarangayStats {
  name: string;
  total: number;
  /// Latest inspection rated 90–100%.
  excellent: number;
  /// Latest inspection rated 70–89%.
  verySatisfactory: number;
  /// Latest inspection rated 0–69%.
  satisfactory: number;
  /// Registered, but never inspected. Not a failure.
  notInspected: number;
  /// Mean of the inspected establishments' scores; null when none is inspected.
  avgScore: number | null;
  establishments: EstablishmentRow[];
}

/// One establishment with coordinates, drawn as a dot coloured by its latest score.
interface EstablishmentPin {
  name: string;
  barangay: string;
  lat: number;
  lng: number;
  score: number | null;
  lastInspected: string;
}

function emptyStats(name: string): BarangayStats {
  return {
    name,
    total: 0,
    excellent: 0,
    verySatisfactory: 0,
    satisfactory: 0,
    notInspected: 0,
    avgScore: null,
    establishments: [],
  };
}

/// The fill for a barangay under risk shading, mirroring the three stat
/// buckets: the lowest band present decides the colour, so one failing
/// establishment is never hidden behind its compliant neighbours.
function riskColor(stats: BarangayStats) {
  if (stats.satisfactory > 0) return colorOfBand("satisfactory");
  if (stats.verySatisfactory > 0) return colorOfBand("verySatisfactory");
  if (stats.excellent > 0) return colorOfBand("excellent");
  return UNSCORED_COLOR;
}

// [REF: GIS_MAP]
export function GISMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const geoLayerRef = useRef<L.GeoJSON | null>(null);
  const pinLayerRef = useRef<L.LayerGroup | null>(null);
  const layersByNameRef = useRef<Map<string, L.Path>>(new Map());

  const [selected, setSelected] = useState<string | null>(null);
  const [shadingEnabled, setShadingEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: establishments } = useCollection(COLLECTIONS.establishments, mapEstablishment);
  const { data: inspectionLogs } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);

  const isLoading = establishments === undefined || inspectionLogs === undefined;

  // [REF: GIS_BARANGAY_AGGREGATION]
  // Join every establishment to its most recent inspection, then group by the
  // barangay boundary its stored barangay name resolves to. An establishment
  // whose barangay matches no boundary is reported separately rather than being
  // attributed to a neighbouring one.
  const { byBarangay, citywide, unmapped, pins } = useMemo(() => {
    const byBarangay = new Map<string, BarangayStats>();
    const citywide = emptyStats("Batangas City");
    const unmapped = new Map<string, number>();
    const pins: EstablishmentPin[] = [];

    if (!establishments || !inspectionLogs) {
      return { byBarangay, citywide, unmapped, pins };
    }

    const latestByEst = new Map<string, any>();
    // Newest log per establishment, compared as ISO-8601 text rather than
    // through `new Date(...)`. The dates are zone-less wall clocks (see
    // `[REF: INSPECTION_DATE_CONVENTION]`), so parsing them buys nothing here and
    // risks a shift; ISO strings already sort chronologically. An undated log
    // loses to any dated one and never wins on a tie.
    for (const log of inspectionLogs) {
      if (!log.establishment_id) continue;
      const prev = latestByEst.get(log.establishment_id);
      if (!prev) {
        latestByEst.set(log.establishment_id, log);
        continue;
      }
      if (byNewestFirst(log, prev) < 0) latestByEst.set(log.establishment_id, log);
    }

    // Running totals for the average, kept alongside each bucket so a barangay
    // with no inspected establishment reports null rather than a misleading 0.
    const scoreSums = new Map<string, { total: number; count: number }>();
    let citySum = 0;
    let cityCount = 0;

    for (const est of establishments) {
      const raw = barangayOfEstablishment(est);
      const name = canonicalBarangay(raw);

      if (!name) {
        const label = raw?.trim() || "(no barangay recorded)";
        unmapped.set(label, (unmapped.get(label) ?? 0) + 1);
        continue;
      }

      let stats = byBarangay.get(name);
      if (!stats) {
        stats = emptyStats(name);
        byBarangay.set(name, stats);
      }

      const log = latestByEst.get(est.id);
      const score = typeof log?.percentage_rating === "number" ? log.percentage_rating : null;

      stats.total++;
      citywide.total++;

      if (score === null) {
        stats.notInspected++;
        citywide.notInspected++;
      } else {
        const band = ratingBand(score);
        if (band === "excellent") {
          stats.excellent++;
          citywide.excellent++;
        } else if (band === "verySatisfactory") {
          stats.verySatisfactory++;
          citywide.verySatisfactory++;
        } else {
          stats.satisfactory++;
          citywide.satisfactory++;
        }

        const sum = scoreSums.get(name) ?? { total: 0, count: 0 };
        sum.total += score;
        sum.count++;
        scoreSums.set(name, sum);
        citySum += score;
        cityCount++;
      }

      const lastInspected = relativeInspectionAge(log?.inspection_date, "Never inspected");
      stats.establishments.push({
        id: est.id,
        name: est.business_name || "Unnamed establishment",
        score,
        inspector: log?.inspector_name ?? null,
        lastInspected,
      });
      if (typeof est.latitude === "number" && typeof est.longitude === "number") {
        pins.push({
          name: est.business_name || "Unnamed establishment",
          barangay: name,
          lat: est.latitude,
          lng: est.longitude,
          score,
          lastInspected,
        });
      }
    }

    for (const [name, sum] of scoreSums) {
      const stats = byBarangay.get(name);
      if (stats && sum.count > 0) stats.avgScore = Math.round(sum.total / sum.count);
    }
    if (cityCount > 0) citywide.avgScore = Math.round(citySum / cityCount);

    for (const stats of byBarangay.values()) {
      // Worst first, so the establishments that need attention are on top;
      // never-inspected ones sit at the bottom.
      stats.establishments.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
    }

    return { byBarangay, citywide, unmapped, pins };
  }, [establishments, inspectionLogs]);

  const maxCount = useMemo(
    () => Math.max(1, ...[...byBarangay.values()].map((s) => s.total)),
    [byBarangay],
  );

  const unmappedTotal = useMemo(
    () => [...unmapped.values()].reduce((a, b) => a + b, 0),
    [unmapped],
  );

  const selectedStats = selected ? byBarangay.get(selected) ?? emptyStats(selected) : null;
  const panelStats = selectedStats ?? citywide;

  const suggestions = useMemo(() => {
    const q = normalizeBarangay(searchQuery);
    if (!q) return [];
    return BARANGAY_NAMES.filter((n) => normalizeBarangay(n).includes(q)).slice(0, 6);
  }, [searchQuery]);

  // Selection is read inside Leaflet event handlers, which are bound once when
  // the layer is built — a ref keeps them looking at the current value without
  // rebuilding 105 polygons on every click.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const styleFor = (name: string, hovered: boolean): L.PathOptions => {
    const stats = byBarangay.get(name);
    const count = stats?.total ?? 0;
    const isSelected = selectedRef.current === name;

    let fillColor = "#94a3b8";
    let fillOpacity = 0.04;

    // Kept light so the roads on the basemap stay readable through the shading.
    if (count > 0) {
      const density = count / maxCount;
      fillColor = shadingEnabled ? riskColor(stats!) : colorOfBand("excellent");
      fillOpacity = 0.1 + density * 0.2;
    }

    return {
      color: isSelected ? "#0f172a" : hovered ? "#334155" : "#ffffff",
      weight: isSelected ? 3 : hovered ? 2 : 1,
      opacity: 1,
      fillColor,
      fillOpacity: isSelected ? fillOpacity + 0.05 : fillOpacity,
    };
  };
  // Read by the Leaflet handlers, same reasoning as selectedRef.
  const styleForRef = useRef(styleFor);
  styleForRef.current = styleFor;

  // Initialise the map and draw the barangay boundaries once. The boundaries are
  // static reference data, so the layer is built a single time and only
  // restyled afterwards.
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      center: CITY_CENTER,
      zoom: 12,
      zoomControl: true,
    });

    // shortcut: OSM's public tile server has no SLA and limits heavy use, move to a keyed provider if traffic grows.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const layer = L.geoJSON(BARANGAY_BOUNDARIES, {
      style: (feature) => styleForRef.current(feature?.properties.name ?? "", false),
      onEachFeature: (feature, lyr) => {
        const name = feature.properties.name as string;
        layersByNameRef.current.set(name, lyr as L.Path);

        lyr.on("click", () => setSelected(name));
        lyr.on("mouseover", () => {
          (lyr as L.Path).setStyle(styleForRef.current(name, true));
          (lyr as L.Path).bringToFront();
        });
        lyr.on("mouseout", () => {
          (lyr as L.Path).setStyle(styleForRef.current(name, false));
        });
        lyr.bindTooltip(name, { sticky: true, direction: "top", className: "font-bold" });
      },
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [20, 20] });

    // Own pane above the polygons, so a hovered barangay's bringToFront never
    // covers the pins.
    map.createPane("pins").style.zIndex = "450";
    pinLayerRef.current = L.layerGroup().addTo(map);

    leafletMapRef.current = map;
    geoLayerRef.current = layer;

    return () => {
      map.remove();
      leafletMapRef.current = null;
      geoLayerRef.current = null;
      pinLayerRef.current = null;
      layersByNameRef.current.clear();
    };
  }, []);

  // [REF: GIS_PINS]
  // One dot per establishment with coordinates, coloured like the barangay
  // panel. Rebuilt in place on every refetch; clicking a dot selects its barangay.
  useEffect(() => {
    const group = pinLayerRef.current;
    if (!group) return;
    group.clearLayers();
    for (const p of pins) {
      // textContent, not an HTML string: names come from the database.
      const label = document.createElement("div");
      label.textContent = `${p.name} · ${p.score === null ? UNSCORED_LABEL : `${p.score}%`} · ${p.lastInspected}`;
      L.circleMarker([p.lat, p.lng], {
        pane: "pins",
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: ratingColor(p.score),
        fillOpacity: 1,
      })
        .bindTooltip(label, { direction: "top", className: "font-bold" })
        .on("click", () => setSelected(p.barangay))
        .addTo(group);
    }
  }, [pins]);

  // Restyle in place when the counts, the selection or the shading toggle
  // change. Rebuilding the layer here would drop hover state and re-run
  // fitBounds on every live refetch.
  useEffect(() => {
    layersByNameRef.current.forEach((lyr, name) => {
      lyr.setStyle(styleFor(name, false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byBarangay, maxCount, selected, shadingEnabled]);

  // Frame whatever is selected — the barangay, or the whole city when cleared.
  useEffect(() => {
    const map = leafletMapRef.current;
    const layer = geoLayerRef.current;
    if (!map || !layer) return;

    if (selected) {
      const target = layersByNameRef.current.get(selected);
      if (target) map.flyToBounds((target as any).getBounds(), { padding: [60, 60], duration: 0.8 });
    } else {
      map.flyToBounds(layer.getBounds(), { padding: [20, 20], duration: 0.8 });
    }
  }, [selected]);

  const selectBarangay = (name: string) => {
    setSelected(name);
    setSearchQuery(name);
    setShowSuggestions(false);
  };

  const resetView = () => {
    setSelected(null);
    setSearchQuery("");
  };

  const tooltipCounts = (name: string) => byBarangay.get(name)?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Live City Health Monitor</h2>
          <p className="text-muted-foreground mt-1 font-medium">
            Compliance by barangay · Batangas City
          </p>
        </div>
        <Button
          variant="outline"
          className={`gap-2 ${shadingEnabled ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-border hover:bg-slate-50"}`}
          onClick={() => setShadingEnabled(!shadingEnabled)}
        >
          <Layers className="w-4 h-4" />
          {shadingEnabled ? "Hide" : "Show"} risk shading
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Map Card */}
        <Card className="p-0 bg-white rounded-xl lg:col-span-3 overflow-hidden relative shadow-sm">

          {/* Floating Search Bar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4">
            <div className="relative shadow-lg rounded-xl">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search barangay..."
                className="pl-10 bg-white border-none shadow-sm text-sm py-5 rounded-xl w-full focus-visible:ring-1 focus-visible:ring-gray-300"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions.length > 0) selectBarangay(suggestions[0]);
                  if (e.key === "Escape") setShowSuggestions(false);
                }}
              />
              {showSuggestions && searchQuery && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl overflow-hidden z-[1001]">
                  {suggestions.map((name) => (
                    <button
                      key={name}
                      className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                      onClick={() => selectBarangay(name)}
                    >
                      <p className="font-bold text-slate-900 text-sm">{name}</p>
                      <p className="text-xs text-muted-foreground font-medium">
                        {tooltipCounts(name)} establishment{tooltipCounts(name) === 1 ? "" : "s"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Reset view */}
          <div className="absolute top-4 right-4 z-[1000]">
            <Button
              size="sm"
              onClick={resetView}
              className="w-10 h-10 p-0 bg-white hover:bg-slate-50 text-slate-900 rounded-lg shadow-md"
              title="Show whole city"
            >
              <Crosshair className="w-5 h-5" />
            </Button>
          </div>

          {/* Leaflet Map Container */}
          <div ref={mapRef} className="w-full h-[650px]" style={{ zIndex: 0 }} />

          {/* [REF: GIS_EMPTY_STATE]
              The boundaries always draw, so an empty map means no establishment
              data — say so plainly instead of leaving a blank choropleth. */}
          {!isLoading && citywide.total === 0 && (
            <div className="absolute inset-x-0 bottom-6 z-[1000] flex justify-center px-4 pointer-events-none">
              <div className="pointer-events-auto max-w-lg rounded-xl bg-white/95 backdrop-blur-md shadow-2xl border border-slate-200 px-5 py-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-slate-900 text-sm">No establishments to show yet</p>
                    <p className="text-sm text-slate-600 font-medium mt-1 leading-relaxed">
                      {unmappedTotal > 0 ? (
                        <>
                          <span className="font-bold text-slate-900">{unmappedTotal}</span>{" "}
                          establishment{unmappedTotal === 1 ? " is" : "s are"} registered, but none
                          has a barangay that matches an official boundary.
                        </>
                      ) : (
                        <>Barangay boundaries are drawn, but no establishments have been registered.</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="p-6 bg-white rounded-xl">
            {selectedStats ? (
              <button
                onClick={resetView}
                className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-slate-900 transition-colors mb-3"
              >
                <ChevronLeft className="w-4 h-4" />
                Whole city
              </button>
            ) : (
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Citywide
              </p>
            )}

            <div className="flex items-start justify-between gap-3 mb-5">
              <h3 className="font-bold text-slate-900 text-lg tracking-tight leading-tight">
                {panelStats.name}
              </h3>
              {panelStats.avgScore !== null && (
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Avg</p>
                  <p className="font-black text-xl leading-none" style={{ color: ratingColor(panelStats.avgScore) }}>
                    {panelStats.avgScore}%
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-sm text-slate-700 font-bold">Establishments</span>
                <span className="font-black text-2xl text-slate-900">{panelStats.total}</span>
              </div>
              {/* [REF: RATING_SCALE] one row per band, in the shared order */}
              {RATING_BANDS.map((b) => (
                <div
                  key={b.band}
                  className="flex items-center justify-between p-4 rounded-xl border"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${b.color} 10%, transparent)`,
                    borderColor: `color-mix(in srgb, ${b.color} 25%, transparent)`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full border-[3px] border-white shadow-sm"
                      style={{ backgroundColor: b.color }}
                    />
                    <div>
                      <p className="text-sm text-slate-700 font-bold leading-tight">{b.label}</p>
                      <p className="text-xs text-muted-foreground font-bold">{b.range}%</p>
                    </div>
                  </div>
                  <span className="font-black text-2xl" style={{ color: b.color }}>
                    {panelStats[b.band]}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-slate-400 border-[3px] border-white shadow-sm" />
                  <span className="text-sm text-slate-700 font-bold">{UNSCORED_LABEL}</span>
                </div>
                <span className="font-black text-2xl text-slate-500">{panelStats.notInspected}</span>
              </div>
            </div>

            {selectedStats && selectedStats.establishments.length > 0 && (
              <div className="mt-5 pt-5 border-t border-slate-100">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
                  Establishments here
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {selectedStats.establishments.map((est) => (
                    <div key={est.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-sm truncate">{est.name}</p>
                        <p className="text-xs text-muted-foreground font-medium truncate">
                          {est.lastInspected}
                          {est.inspector ? ` · ${est.inspector}` : ""}
                        </p>
                      </div>
                      <span
                        className="font-black text-sm flex-shrink-0"
                        style={{ color: ratingColor(est.score) }}
                      >
                        {est.score === null ? "—" : `${est.score}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedStats && selectedStats.total === 0 && (
              <p className="mt-5 text-sm text-slate-600 font-medium leading-relaxed">
                No establishments are registered in this barangay yet.
              </p>
            )}
          </Card>

          <Card className="p-6 bg-white rounded-xl">
            <h3 className="font-bold text-slate-900 mb-5 text-lg tracking-tight">Legend</h3>
            <div className="space-y-4">
              {[
                ...RATING_BANDS.map(b => ({ color: b.color, label: b.label, range: `${b.range}%` })),
                { color: UNSCORED_COLOR, label: UNSCORED_LABEL, range: "No inspection on record" },
              ].map(({ color, label, range }) => (
                <div key={label} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg border-[3px] border-white shadow-md flex-shrink-0" style={{ backgroundColor: color }} />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{label}</p>
                    <p className="text-xs text-muted-foreground font-bold">{range}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-5 leading-relaxed">
              A barangay is shaded by its worst-rated establishment; darker fill means more
              establishments registered there.
            </p>
          </Card>

          {citywide.satisfactory > 0 && (
            <Card className="p-6 bg-red-50 rounded-xl border border-red-200 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h3 className="font-bold text-red-600 text-lg">Critical Alerts</h3>
              </div>
              <p className="text-sm text-slate-700 font-medium leading-relaxed">
                <span className="font-black text-slate-900">{citywide.satisfactory}</span> establishment
                {citywide.satisfactory === 1 ? "" : "s"} citywide scored below {PASSING_SCORE}% on the latest
                inspection — the lowest rating band.
              </p>
            </Card>
          )}

          {/* [REF: GIS_UNMAPPED]
              Establishments whose stored barangay matches no official boundary
              are missing from every count above. Naming them is the only way an
              admin can fix the underlying record. */}
          {unmappedTotal > 0 && (
            <Card className="p-6 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <MapPin className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-amber-700 text-base">Not on the map</h3>
              </div>
              <p className="text-sm text-slate-700 font-medium leading-relaxed mb-3">
                <span className="font-black text-slate-900">{unmappedTotal}</span> establishment
                {unmappedTotal === 1 ? " has" : "s have"} a barangay that matches no official
                boundary, so {unmappedTotal === 1 ? "it is" : "they are"} excluded from the counts above.
              </p>
              <div className="space-y-1">
                {[...unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 truncate">{label}</span>
                    <span className="font-black text-amber-700 flex-shrink-0 ml-2">{count}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
