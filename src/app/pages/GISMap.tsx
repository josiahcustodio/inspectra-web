import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MapPin, Layers, Search, AlertTriangle, Clock, User as UserIcon, X, Crosshair } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default marker icon issue with Vite + Leaflet
// @ts-ignore
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
// @ts-ignore
import markerIcon from "leaflet/dist/images/marker-icon.png";
// @ts-ignore
import markerShadow from "leaflet/dist/images/marker-shadow.png";
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const mapPins = [
  { id: 1, lat: 13.7565, lng: 121.0583, score: 92, grade: "A", name: "Golden Fortune Restaurant", barangay: "Poblacion", inspector: "Inspector 01", lastInspected: "2 hours ago", status: "Excellent" },
  { id: 2, lat: 13.7650, lng: 121.0601, score: 88, grade: "A", name: "Batangas Bay Hotel", barangay: "Cuta", inspector: "Inspector 03", lastInspected: "5 hours ago", status: "Excellent" },
  { id: 3, lat: 13.7485, lng: 121.0505, score: 75, grade: "B", name: "Quick Bites Cafeteria", barangay: "Kumintang Ibaba", inspector: "Inspector 02", lastInspected: "1 day ago", status: "Satisfactory" },
  { id: 4, lat: 13.7520, lng: 121.0450, score: 58, grade: "C", name: "Ocean View Eatery", barangay: "Santa Clara", inspector: "Inspector 04", lastInspected: "2 days ago", status: "Needs Re-inspection" },
  { id: 5, lat: 13.7600, lng: 121.0700, score: 95, grade: "A", name: "Sunrise Bakery", barangay: "Gulod Labac", inspector: "Inspector 01", lastInspected: "3 hours ago", status: "Excellent" },
  { id: 6, lat: 13.7710, lng: 121.0650, score: 72, grade: "B", name: "City Market", barangay: "Kumintang Ilaya", inspector: "Inspector 03", lastInspected: "6 hours ago", status: "Satisfactory" },
  { id: 7, lat: 13.7450, lng: 121.0620, score: 45, grade: "F", name: "Old Town Diner", barangay: "Wawa", inspector: "Inspector 02", lastInspected: "1 day ago", status: "Critical - Failed" },
  { id: 8, lat: 13.7800, lng: 121.0550, score: 93, grade: "A", name: "Fresh Mart Supermarket", barangay: "Alangilan", inspector: "Inspector 04", lastInspected: "4 hours ago", status: "Excellent" },
  { id: 9, lat: 13.7550, lng: 121.0650, score: 78, grade: "B", name: "Central Plaza Food Court", barangay: "Poblacion", inspector: "Inspector 01", lastInspected: "8 hours ago", status: "Satisfactory" },
  { id: 10, lat: 13.7750, lng: 121.0400, score: 91, grade: "A", name: "Harbor View Restaurant", barangay: "Bolbok", inspector: "Inspector 03", lastInspected: "5 hours ago", status: "Excellent" },
  { id: 11, lat: 13.7650, lng: 121.0750, score: 62, grade: "C", name: "Street Food Corner", barangay: "San Isidro", inspector: "Inspector 02", lastInspected: "1 day ago", status: "Needs Re-inspection" },
  { id: 12, lat: 13.7850, lng: 121.0600, score: 96, grade: "A", name: "University Cafeteria", barangay: "Alangilan", inspector: "Inspector 04", lastInspected: "3 hours ago", status: "Excellent" },
  { id: 13, lat: 13.7420, lng: 121.0550, score: 68, grade: "C", name: "Riverside Grill", barangay: "Malitam", inspector: "Inspector 01", lastInspected: "12 hours ago", status: "Needs Re-inspection" },
  { id: 14, lat: 13.7500, lng: 121.0700, score: 82, grade: "B", name: "Downtown Café", barangay: "Pallocan West", inspector: "Inspector 03", lastInspected: "7 hours ago", status: "Satisfactory" },
  { id: 15, lat: 13.7600, lng: 121.0500, score: 48, grade: "F", name: "Night Market Stalls", barangay: "Poblacion", inspector: "Inspector 02", lastInspected: "18 hours ago", status: "Critical - Failed" },
];

type Pin = typeof mapPins[0];

function getScoreColor(score: number) {
  if (score >= 90) return "#87A96B";
  if (score >= 70) return "#DAA520";
  return "#DC143C";
}

function getStatusBadge(status: string, score: number) {
  if (score < 70) return { icon: "⚠️", text: status, color: "#DC143C", bg: "#fee" };
  if (score < 90) return { icon: "⚡", text: status, color: "#DAA520", bg: "#fffbeb" };
  return { icon: "✓", text: status, color: "#87A96B", bg: "#f0f4ed" };
}

function createCustomIcon(score: number, isSelected: boolean) {
  const color = getScoreColor(score);
  const size = isSelected ? 44 : 32;
  const html = `
    <div style="position:relative;width:${size}px;height:${size + 10}px;">
      <div style="
        width:${size}px;height:${size}px;border-radius:50%;
        background:${color};border:4px solid white;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;
        ${isSelected ? 'box-shadow:0 6px 20px rgba(0,0,0,0.4);' : ''}
      ">
        <div style="width:8px;height:8px;background:white;border-radius:50%;"></div>
      </div>
      <div style="
        position:absolute;left:50%;top:${size - 4}px;transform:translateX(-50%);
        width:0;height:0;
        border-left:7px solid transparent;
        border-right:7px solid transparent;
        border-top:10px solid ${color};
        filter:drop-shadow(0 2px 2px rgba(0,0,0,0.2));
      "></div>
      ${isSelected ? `<div style="
        position:absolute;top:0;left:0;width:${size}px;height:${size}px;
        border-radius:50%;background:${color};opacity:0.3;
        animation:ping 1s cubic-bezier(0,0,0.2,1) infinite;
      "></div>` : ''}
    </div>
  `;
  return L.divIcon({
    className: "",
    html,
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size + 10],
  });
}

export function GISMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const heatCirclesRef = useRef<L.Circle[]>([]);

  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const passedCount = mapPins.filter(p => p.score >= 90).length;
  const warningCount = mapPins.filter(p => p.score >= 70 && p.score < 90).length;
  const failedCount = mapPins.filter(p => p.score < 70).length;

  const filteredSuggestions = mapPins.filter(pin =>
    pin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pin.barangay.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5);

  // Initialize the Leaflet map once
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      center: [13.7600, 121.0550],
      zoom: 14,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    // Add markers
    mapPins.forEach((pin) => {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: createCustomIcon(pin.score, false),
      }).addTo(map);

      marker.on("click", () => {
        setSelectedPin(pin);
      });

      markersRef.current.set(pin.id, marker);
    });

    leafletMapRef.current = map;

    return () => {
      map.remove();
      leafletMapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // Update marker icons when selection changes
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const pin = mapPins.find(p => p.id === id);
      if (pin) {
        marker.setIcon(createCustomIcon(pin.score, selectedPin?.id === id));
      }
    });

    if (selectedPin && leafletMapRef.current) {
      leafletMapRef.current.flyTo([selectedPin.lat, selectedPin.lng], 16, {
        animate: true,
        duration: 1,
      });
    }
  }, [selectedPin]);

  // Toggle heatmap circles
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    heatCirclesRef.current.forEach(c => c.remove());
    heatCirclesRef.current = [];

    if (heatmapEnabled) {
      mapPins.filter(p => p.score < 70).forEach(pin => {
        const circle = L.circle([pin.lat, pin.lng], {
          radius: 500,
          color: "transparent",
          fillColor: "#DC143C",
          fillOpacity: 0.22,
        }).addTo(map);
        heatCirclesRef.current.push(circle);
      });
    }
  }, [heatmapEnabled]);

  const centerMap = () => {
    setSelectedPin(null);
    setSearchQuery("");
    leafletMapRef.current?.flyTo([13.7600, 121.0550], 14, { animate: true, duration: 1 });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Live City Health Monitor</h2>
          <p className="text-muted-foreground mt-1 font-medium">Real-time geographic visualization · Batangas City</p>
        </div>
        <Button
          variant="outline"
          className={`gap-2 ${heatmapEnabled ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-border hover:bg-slate-50"}`}
          onClick={() => setHeatmapEnabled(!heatmapEnabled)}
        >
          <Layers className="w-4 h-4" />
          {heatmapEnabled ? "Hide" : "Show"} Heatmap
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Map Card */}
        <Card className="p-0 bg-white rounded-xl  lg:col-span-3 overflow-hidden relative shadow-sm">

          {/* Floating Search Bar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4">
            <div className="relative shadow-lg rounded-xl">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Locate establishment by name or barangay..."
                className="pl-10 bg-white border-none shadow-sm text-sm py-5 rounded-xl w-full focus-visible:ring-1 focus-visible:ring-gray-300"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              />
              {showSuggestions && searchQuery && filteredSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white  rounded-xl shadow-xl overflow-hidden z-[1001]">
                  {filteredSuggestions.map((pin) => (
                    <button
                      key={pin.id}
                      className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                      onClick={() => { setSelectedPin(pin); setSearchQuery(pin.name); setShowSuggestions(false); }}
                    >
                      <p className="font-bold text-slate-900 text-sm">{pin.name}</p>
                      <p className="text-xs text-muted-foreground font-medium">{pin.barangay} · Score: {pin.score}%</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center button */}
          <div className="absolute top-4 right-4 z-[1000]">
            <Button
              size="sm"
              onClick={centerMap}
              className="w-10 h-10 p-0 bg-white hover:bg-slate-50 text-slate-900 rounded-lg shadow-md "
              title="Center Map"
            >
              <Crosshair className="w-5 h-5" />
            </Button>
          </div>

          {/* Leaflet Map Container */}
          <div ref={mapRef} className="w-full h-[650px]" style={{ zIndex: 0 }} />

          {/* Selected Pin Detail Panel */}
          {selectedPin && (
            <div className="absolute left-6 top-1/2 -translate-y-1/2 z-[1000] w-82 pointer-events-none">
              <Card className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl  overflow-hidden pointer-events-auto">
                <div className="p-5">
                  <button
                    onClick={() => setSelectedPin(null)}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-slate-900 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <h3 className="font-bold text-slate-900 text-xl mb-3 pr-8 leading-tight tracking-tight">
                    {selectedPin.name}
                  </h3>

                  {(() => {
                    const badge = getStatusBadge(selectedPin.status, selectedPin.score);
                    return (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-4 shadow-sm border"
                        style={{ backgroundColor: badge.bg, color: badge.color, borderColor: `${badge.color}30` }}
                      >
                        <span>{badge.icon}</span>
                        <span>{badge.text}</span>
                      </span>
                    );
                  })()}

                  <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                    <p className="text-muted-foreground text-xs font-bold mb-1 uppercase tracking-wider">Health Score</p>
                    <div className="flex items-baseline gap-2">
                      <span className="font-black text-5xl" style={{ color: getScoreColor(selectedPin.score), lineHeight: 1 }}>
                        {selectedPin.score}%
                      </span>
                      <span className="text-muted-foreground font-bold text-sm">/ 100</span>
                    </div>
                  </div>

                  <div className="space-y-3 mb-5 px-1">
                    <div className="flex items-center gap-3 text-sm">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-slate-600 font-medium">Inspected: <span className="font-bold text-slate-900">{selectedPin.lastInspected}</span></span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <UserIcon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-slate-600 font-medium">By: <span className="font-bold text-slate-900">{selectedPin.inspector}</span></span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="text-slate-900 font-bold">{selectedPin.barangay}</span>
                    </div>
                  </div>

                  <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold py-3 h-auto shadow-md">
                    View Full Report
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="p-6 bg-white rounded-xl ">
            <h3 className="font-bold text-slate-900 mb-5 text-lg tracking-tight">Quick Statistics</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-emerald-500 border-[3px] border-white shadow-sm" />
                  <span className="text-sm text-slate-700 font-bold">Passed</span>
                </div>
                <span className="font-black text-2xl text-emerald-600">{passedCount}</span>
              </div>
              <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-amber-500 border-[3px] border-white shadow-sm" />
                  <span className="text-sm text-slate-700 font-bold">Warning</span>
                </div>
                <span className="font-black text-2xl text-amber-600">{warningCount}</span>
              </div>
              <div className="flex items-center justify-between p-4 rounded-xl bg-red-50 border border-red-100">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-red-500 border-[3px] border-white shadow-sm" />
                  <span className="text-sm text-slate-700 font-bold">Failed</span>
                </div>
                <span className="font-black text-2xl text-red-600">{failedCount}</span>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white rounded-xl ">
            <h3 className="font-bold text-slate-900 mb-5 text-lg tracking-tight">Legend</h3>
            <div className="space-y-4">
              {[
                { color: "#10b981", label: "Excellent", range: "90–100%" },
                { color: "#f59e0b", label: "Satisfactory", range: "70–89%" },
                { color: "#ef4444", label: "Critical", range: "Below 70%" },
              ].map(({ color, label, range }) => (
                <div key={label} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full border-[3px] border-white shadow-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color }}>
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{label}</p>
                    <p className="text-xs text-muted-foreground font-bold">{range}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {failedCount > 0 && (
            <Card className="p-6 bg-red-50 rounded-xl border border-red-200 shadow-sm animate-pulse-subtle">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h3 className="font-bold text-red-600 text-lg">Critical Alerts</h3>
              </div>
              <p className="text-sm text-slate-700 font-medium leading-relaxed">
                <span className="font-black text-slate-900">{failedCount}</span> establishments require immediate attention
              </p>
              <Button size="sm" className="w-full mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-3 h-auto shadow-lg shadow-red-200">
                View All Critical Cases
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
