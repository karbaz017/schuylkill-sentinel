"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { SPOTS } from "@/data/spots";
import type { Assessment } from "@/lib/types";

const BOUNDS = L.latLngBounds(SPOTS.map((s) => [s.lat, s.lng] as [number, number])).pad(0.06);

function icon(a: Assessment | undefined, selected: boolean) {
  const band = a?.band ?? "green";
  return L.divIcon({
    className: "ss-icon",
    html: `<div class="ss-marker band-${band}${selected ? " selected" : ""}" role="button" aria-label="${a?.spotName ?? ""}: ${a?.label ?? "loading"}">${a ? a.score : "·"}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function FlyTo({ spotId }: { spotId?: string }) {
  const map = useMap();
  useEffect(() => {
    const s = SPOTS.find((x) => x.id === spotId);
    if (s) map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 13), { duration: 0.8 });
  }, [spotId, map]);
  return null;
}

function FitOnResize() {
  const map = useMap();
  useEffect(() => {
    const fit = () => map.fitBounds(BOUNDS, { padding: [12, 12] });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    fit();
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function RiverMap({
  assessments,
  selected,
  onSelect,
  flyTo,
}: {
  assessments: Assessment[];
  selected?: string;
  onSelect: (id: string) => void;
  flyTo?: string;
}) {
  const byId = useMemo(() => Object.fromEntries(assessments.map((a) => [a.spotId, a])), [assessments]);
  return (
    <MapContainer
      bounds={BOUNDS}
      scrollWheelZoom={false}
      className="h-full w-full"
      zoomControl
      attributionControl
      minZoom={10}
      maxZoom={17}
    >
      <TileLayer
        className="night-tiles"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitOnResize />
      <FlyTo spotId={flyTo} />
      {SPOTS.map((s) => {
        const a = byId[s.id];
        return (
          <Marker
            key={s.id + (a?.band ?? "") + (a?.score ?? "") + (selected === s.id ? "-sel" : "")}
            position={[s.lat, s.lng]}
            icon={icon(a, selected === s.id)}
            eventHandlers={{ click: () => onSelect(s.id) }}
            keyboard
            title={s.name}
          >
            <Tooltip direction="top" offset={[0, -18]} opacity={1} className="!rounded-lg !border-0 !bg-[#0a1624] !text-[#e7f2f8] !shadow-xl">
              <span className="font-semibold">{s.name}</span>
              {a && <span className="ml-1.5 opacity-70">{a.label}</span>}
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
