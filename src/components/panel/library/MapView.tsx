import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from '../../../utils/leaflet-setup';
import 'leaflet.markercluster';
import { invoke } from '@tauri-apps/api/core';
import { Maximize2, Layers, Image as ImageIcon, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import debounce from 'lodash.debounce';
import { ImageFile, Invokes } from '../../ui/AppProperties';
import { useProcessStore } from '../../../store/useProcessStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { getImageGps, getImageTimestamp, GeoLocation } from '../../../utils/gpsUtils';

export type MapStyle = 'dark' | 'osm' | 'satellite';

interface MapLayerConfig {
  id: MapStyle;
  label: string;
  icon: string;
  url: string;
  attribution: string;
  className?: string;
  maxZoom: number;
}

const MAP_LAYERS: Record<MapStyle, MapLayerConfig> = {
  dark: {
    id: 'dark',
    label: 'Dark OSM',
    icon: '🌙',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    className: 'dark-map-tiles',
    maxZoom: 19,
  },
  osm: {
    id: 'osm',
    label: 'OpenStreetMap',
    icon: '☀️',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    className: '',
    maxZoom: 19,
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    icon: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community',
    className: '',
    maxZoom: 19,
  },
};

const MAP_STYLE_STORAGE_KEY = 'rapidraw_map_tile_style';
const MAP_SHOW_THUMBNAILS_STORAGE_KEY = 'rapidraw_map_show_thumbnails';

function getInitialMapStyle(): MapStyle {
  try {
    const saved = localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    if (saved && (saved === 'dark' || saved === 'osm' || saved === 'satellite')) {
      return saved as MapStyle;
    }
  } catch (e) {
    console.error('Failed to read map style from localStorage', e);
  }
  return 'dark';
}

function getInitialShowThumbnails(): boolean {
  try {
    const saved = localStorage.getItem(MAP_SHOW_THUMBNAILS_STORAGE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch (e) {
    console.error('Failed to read show thumbnails setting from localStorage', e);
  }
  return true;
}

interface MapPhotoItem {
  id: string;
  path: string;
  filename: string;
  lat: number;
  lon: number;
  timestamp: string | null;
  isRaw: boolean;
  image: ImageFile;
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toUpperCase() : '';
}

function createCustomPin(isSelected: boolean, isRaw: boolean): L.DivIcon {
  const primaryColor = isSelected ? '#38bdf8' : isRaw ? '#f59e0b' : '#0284c7';
  const glow = isSelected ? 'filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.9));' : '';

  const html = `
    <div style="${glow} transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); transform: ${
      isSelected ? 'scale(1.25)' : 'scale(1)'
    }; cursor: pointer;">
      <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36C14 36 28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="${primaryColor}"/>
        <circle cx="14" cy="14" r="11" fill="#0f172a"/>
        <circle cx="14" cy="14" r="5" fill="${primaryColor}"/>
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-photo-pin',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -32],
  });
}

function createThumbnailLoadingPin(isSelected: boolean, isRaw: boolean, filename: string): L.DivIcon {
  const borderColor = isSelected ? '#38bdf8' : isRaw ? '#f59e0b' : '#0284c7';
  const glow = isSelected
    ? 'box-shadow: 0 0 16px rgba(56, 189, 248, 0.9), 0 4px 10px rgba(0, 0, 0, 0.6);'
    : 'box-shadow: 0 4px 10px rgba(0, 0, 0, 0.6);';
  const scale = isSelected ? 'scale(1.15)' : 'scale(1)';
  const ext = getFileExtension(filename);

  const html = `
    <div style="position: relative; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); transform: ${scale}; cursor: pointer; display: flex; flex-direction: column; align-items: center;">
      <div style="
        width: 96px;
        height: 96px;
        border-radius: 12px;
        border: ${isSelected ? '3px' : '2px'} solid ${borderColor};
        overflow: hidden;
        background-color: #0f172a;
        ${glow}
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      ">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${borderColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
        <span style="
          position: absolute;
          top: 4px;
          right: 4px;
          font-size: 11px;
          font-weight: 800;
          background: ${isRaw ? 'rgba(120, 53, 15, 0.92)' : 'rgba(12, 74, 110, 0.92)'};
          color: ${isRaw ? '#fde68a' : '#bae6fd'};
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid ${isRaw ? '#d97706' : '#0284c7'};
          text-transform: uppercase;
        ">${ext || (isRaw ? 'RAW' : 'IMG')}</span>
      </div>
      <div style="
        width: 0;
        height: 0;
        border-left: 9px solid transparent;
        border-right: 9px solid transparent;
        border-top: 10px solid ${borderColor};
        margin-top: -1px;
      "></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'photo-thumbnail-pin-loading',
    iconSize: [96, 106],
    iconAnchor: [48, 106],
    popupAnchor: [0, -100],
  });
}

function createPhotoThumbnailPin(
  thumbnailUrl: string,
  isSelected: boolean,
  isRaw: boolean,
  filename: string,
): L.DivIcon {
  const borderColor = isSelected ? '#38bdf8' : isRaw ? '#f59e0b' : '#0284c7';
  const glow = isSelected
    ? 'box-shadow: 0 0 16px rgba(56, 189, 248, 0.9), 0 4px 10px rgba(0, 0, 0, 0.6);'
    : 'box-shadow: 0 4px 10px rgba(0, 0, 0, 0.6);';
  const scale = isSelected ? 'scale(1.15)' : 'scale(1)';
  const ext = getFileExtension(filename);

  const html = `
    <div style="position: relative; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); transform: ${scale}; cursor: pointer; display: flex; flex-direction: column; align-items: center;">
      <div style="
        width: 96px;
        height: 96px;
        border-radius: 12px;
        border: ${isSelected ? '3px' : '2px'} solid ${borderColor};
        overflow: hidden;
        background-color: #0b0f19;
        ${glow}
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      ">
        <img
          src="${thumbnailUrl}"
          alt="${filename}"
          style="width: 100%; height: 100%; object-fit: cover; display: block;"
          loading="eager"
        />
        ${
          isRaw
            ? `<span style="
                position: absolute;
                top: 4px;
                right: 4px;
                font-size: 11px;
                font-weight: 800;
                background: rgba(120, 53, 15, 0.92);
                color: #fde68a;
                padding: 2px 6px;
                border-radius: 4px;
                border: 1px solid #d97706;
                text-transform: uppercase;
                letter-spacing: -0.5px;
              ">${ext || 'RAW'}</span>`
            : ''
        }
      </div>
      <div style="
        width: 0;
        height: 0;
        border-left: 9px solid transparent;
        border-right: 9px solid transparent;
        border-top: 10px solid ${borderColor};
        margin-top: -1px;
      "></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'photo-thumbnail-pin',
    iconSize: [96, 106],
    iconAnchor: [48, 106],
    popupAnchor: [0, -100],
  });
}

function createClusterThumbnailPin(thumbnailUrl: string, count: number): L.DivIcon {
  const countLabel = count > 999 ? '999+' : count.toString();

  const html = `
    <div style="position: relative; cursor: pointer; display: flex; flex-direction: column; align-items: center; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">
      <!-- Stack background card 2 (bottom layer) -->
      <div style="
        position: absolute;
        width: 90px;
        height: 90px;
        top: -4px;
        left: 5px;
        border-radius: 12px;
        background: #0f172a;
        border: 2px solid rgba(56, 189, 248, 0.35);
        transform: rotate(4deg);
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
      "></div>

      <!-- Stack background card 1 (middle layer) -->
      <div style="
        position: absolute;
        width: 93px;
        height: 93px;
        top: -2px;
        left: 1px;
        border-radius: 12px;
        background: #1e293b;
        border: 2px solid rgba(56, 189, 248, 0.6);
        transform: rotate(-3deg);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      "></div>

      <!-- Front main card with thumbnail -->
      <div style="
        position: relative;
        width: 96px;
        height: 96px;
        border-radius: 12px;
        border: 3px solid #38bdf8;
        overflow: hidden;
        background-color: #0b0f19;
        box-shadow: 0 0 16px rgba(56, 189, 248, 0.5), 0 8px 16px rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <img
          src="${thumbnailUrl}"
          alt="Cluster"
          style="width: 100%; height: 100%; object-fit: cover; display: block;"
          loading="eager"
        />

        <!-- Count Badge in top-right corner with layers icon -->
        <div style="
          position: absolute;
          top: 4px;
          right: 4px;
          background: #0284c7;
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          padding: 2px 6px;
          border-radius: 9999px;
          border: 1.5px solid #38bdf8;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          gap: 3px;
          z-index: 10;
        ">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.9;">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
          <span>${countLabel}</span>
        </div>
      </div>

      <!-- Pointer triangle -->
      <div style="
        width: 0;
        height: 0;
        border-left: 9px solid transparent;
        border-right: 9px solid transparent;
        border-top: 10px solid #38bdf8;
        margin-top: -1px;
      "></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'photo-cluster-thumbnail-pin',
    iconSize: [96, 106],
    iconAnchor: [48, 106],
  });
}

function createClusterLoadingPin(count: number): L.DivIcon {
  const countLabel = count > 999 ? '999+' : count.toString();

  const html = `
    <div style="position: relative; cursor: pointer; display: flex; flex-direction: column; align-items: center; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">
      <!-- Stack background card 2 -->
      <div style="
        position: absolute;
        width: 90px;
        height: 90px;
        top: -4px;
        left: 5px;
        border-radius: 12px;
        background: #0f172a;
        border: 2px solid rgba(56, 189, 248, 0.35);
        transform: rotate(4deg);
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
      "></div>

      <!-- Stack background card 1 -->
      <div style="
        position: absolute;
        width: 93px;
        height: 93px;
        top: -2px;
        left: 1px;
        border-radius: 12px;
        background: #1e293b;
        border: 2px solid rgba(56, 189, 248, 0.6);
        transform: rotate(-3deg);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      "></div>

      <!-- Front card placeholder -->
      <div style="
        position: relative;
        width: 96px;
        height: 96px;
        border-radius: 12px;
        border: 3px solid #38bdf8;
        overflow: hidden;
        background-color: #0f172a;
        box-shadow: 0 0 16px rgba(56, 189, 248, 0.5), 0 8px 16px rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
          <polyline points="2 12 12 17 22 12"/>
        </svg>

        <!-- Count Badge in top-right corner with layers icon -->
        <div style="
          position: absolute;
          top: 4px;
          right: 4px;
          background: #0284c7;
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          padding: 2px 6px;
          border-radius: 9999px;
          border: 1.5px solid #38bdf8;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          gap: 3px;
          z-index: 10;
        ">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.9;">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
          <span>${countLabel}</span>
        </div>
      </div>

      <!-- Pointer triangle -->
      <div style="
        width: 0;
        height: 0;
        border-left: 9px solid transparent;
        border-right: 9px solid transparent;
        border-top: 10px solid #38bdf8;
        margin-top: -1px;
      "></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'photo-cluster-thumbnail-pin-loading',
    iconSize: [96, 106],
    iconAnchor: [48, 106],
  });
}

function createCompactClusterPin(count: number): L.DivIcon {
  const countLabel = count > 999 ? '999+' : count.toString();
  const c = count < 10 ? 'small' : count < 100 ? 'medium' : 'large';
  return L.divIcon({
    html: `<div><span>${countLabel}</span></div>`,
    className: `marker-cluster marker-cluster-${c}`,
    iconSize: new L.Point(40, 40),
  });
}

function buildPopupHtml(photo: MapPhotoItem, thumbUrl: string | undefined, dblClickHint: string): string {
  const ext = getFileExtension(photo.filename);

  return `
    <div style="font-family: inherit; font-size: 13px; color: #f8fafc; width: 480px; max-width: 520px;" data-photo-path="${photo.path}">
      ${
        thumbUrl
          ? `<div style="width: 100%; height: 260px; border-radius: 8px; overflow: hidden; margin-bottom: 12px; background: #0b0f19; border: 1px solid #334155; cursor: pointer;">
               <img src="${thumbUrl}" alt="${photo.filename}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
             </div>`
          : ''
      }
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 15px; color: #fff; word-break: break-all;">
          ${photo.filename}
        </span>
        <span style="
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 5px;
          background-color: ${photo.isRaw ? '#78350f' : '#0c4a6e'};
          color: ${photo.isRaw ? '#fde68a' : '#bae6fd'};
          border: 1px solid ${photo.isRaw ? '#d97706' : '#0284c7'};
        ">
          ${ext || 'IMG'}
        </span>
      </div>

      ${
        photo.timestamp
          ? `<div style="display: flex; align-items: center; gap: 6px; color: #94a3b8; font-size: 12px; margin-bottom: 5px;">
               <span>📅 ${photo.timestamp}</span>
             </div>`
          : ''
      }

      <div style="display: flex; align-items: center; gap: 6px; color: #38bdf8; font-family: monospace; font-size: 12px; margin-bottom: 8px;">
        <span>📍 ${photo.lat.toFixed(6)}°, ${photo.lon.toFixed(6)}°</span>
      </div>

      <div style="color: #64748b; font-size: 11px; word-break: break-all; margin-bottom: 8px;">
        ${photo.path}
      </div>

      <div style="font-size: 11px; color: #38bdf8; text-align: center; border-top: 1px solid #334155; padding-top: 8px; opacity: 0.9;">
        ${dblClickHint}
      </div>
    </div>
  `;
}

interface PhotoClusterLayerProps {
  photos: MapPhotoItem[];
  selectedPath: string | null;
  currentFolderPath?: string | null;
  onSelectPhoto: (path: string, event: MouseEvent) => void;
  onDoubleClickPhoto: (path: string) => void;
  onContextMenuPhoto: (event: MouseEvent, path: string) => void;
  showThumbnailCards: boolean;
  onRequestThumbnails?: (paths: string[]) => void;
}

const PhotoClusterLayer: React.FC<PhotoClusterLayerProps> = ({
  photos,
  selectedPath,
  currentFolderPath,
  onSelectPhoto,
  onDoubleClickPhoto,
  onContextMenuPhoto,
  showThumbnailCards,
  onRequestThumbnails,
}) => {
  const map = useMap();
  const [cluster, setCluster] = useState<L.MarkerClusterGroup | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());
  const hasInitialFitRef = useRef<boolean>(false);
  const prevSelectedPathRef = useRef<string | null>(null);
  const prevThumbnailsKeysRef = useRef<Set<string>>(new Set());
  const thumbnails = useProcessStore((s) => s.thumbnails);
  const { t } = useTranslation();

  const showThumbnailCardsRef = useRef<boolean>(showThumbnailCards);
  useEffect(() => {
    showThumbnailCardsRef.current = showThumbnailCards;
  }, [showThumbnailCards]);

  // Reset initial fit flag when switching folders
  useEffect(() => {
    hasInitialFitRef.current = false;
  }, [currentFolderPath]);

  const dblClickHint = t('library.map.doubleClickHint', {
    defaultValue: 'Doppio click per aprire in modalità Adjustments',
  });

  // Initialize marker cluster once into reactive state with controlled click behavior and photo icons
  useEffect(() => {
    const clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      spiderfyDistanceMultiplier: 2.2,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: false, // We control the click behavior predictably below
      disableClusteringAtZoom: 17,
      iconCreateFunction: (c: L.MarkerCluster) => {
        const count = c.getChildCount();
        if (!showThumbnailCardsRef.current) {
          return createCompactClusterPin(count);
        }

        const childMarkers = c.getAllChildMarkers();
        const currentThumbs = useProcessStore.getState().thumbnails;

        // 1. High performance: prioritize any photo in cluster that ALREADY has a cached thumbnail
        let cachedThumbUrl: string | null = null;
        for (let i = 0; i < childMarkers.length; i++) {
          const path = (childMarkers[i] as any).photoPath;
          if (path && currentThumbs[path]) {
            cachedThumbUrl = currentThumbs[path];
            break;
          }
        }

        if (cachedThumbUrl) {
          return createClusterThumbnailPin(cachedThumbUrl, count);
        }

        return createClusterLoadingPin(count);
      },
    });

    const handleClusterClick = (e: L.LeafletEvent) => {
      const clusterMarker = (e as any).layer as L.MarkerCluster;
      if (!clusterMarker) return;

      const bounds = clusterMarker.getBounds();
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const distance = ne.distanceTo(sw); // distance in meters across photos in cluster

      const currentZoom = map.getZoom();

      // If all photos in this cluster are within ~15 meters of each other (e.g. same spot/monument)
      // or if we are already zoomed in close (zoom >= 16):
      // Spiderfy them in place without any violent zoom jumps!
      if (distance < 15 || currentZoom >= 16) {
        clusterMarker.spiderfy();
      } else {
        // Geographically dispersed photos:
        // Smoothly advance by at most 2 levels at a time (capped at zoom 16 to avoid street-level plunge)
        const maxFitZoom = map.getBoundsZoom(bounds);
        const targetZoom = Math.min(currentZoom + 2, maxFitZoom, 16);

        map.flyTo(bounds.getCenter(), Math.max(targetZoom, currentZoom + 1), {
          duration: 0.45,
        });
      }
    };

    clusterGroup.on('clusterclick', handleClusterClick);

    map.addLayer(clusterGroup);
    setCluster(clusterGroup);

    return () => {
      clusterGroup.off('clusterclick', handleClusterClick);
      clusterGroup.clearLayers();
      map.removeLayer(clusterGroup);
      markersMapRef.current.clear();
      setCluster(null);
    };
  }, [map]);

  // Lazy request visible thumbnails for standalone pins and cluster representatives in viewport
  const requestVisibleThumbnails = useCallback(() => {
    if (!showThumbnailCards || !onRequestThumbnails || !map || !cluster) return;

    try {
      const bounds = map.getBounds();
      const currentThumbs = useProcessStore.getState().thumbnails;
      const missing: string[] = [];
      const seenClusters = new Set<any>();

      for (const photo of photos) {
        if (missing.length >= 30) break;

        const marker = markersMapRef.current.get(photo.path);
        if (!marker) continue;

        // Check if marker coordinate is within the current viewport
        if (!bounds.contains([photo.lat, photo.lon])) continue;

        const visibleParent = cluster.getVisibleParent(marker);
        if (!visibleParent) continue;

        if (visibleParent === marker) {
          // Standalone visible pin
          if (!currentThumbs[photo.path] && !missing.includes(photo.path)) {
            missing.push(photo.path);
          }
        } else {
          // Inside a visible cluster
          if (seenClusters.has(visibleParent)) continue;
          seenClusters.add(visibleParent);

          // Check if ANY photo in this cluster already has a cached thumbnail
          const childMarkers = (visibleParent as L.MarkerCluster).getAllChildMarkers();
          const hasAnyCachedThumb = childMarkers.some((m) => {
            const p = (m as any).photoPath;
            return p && Boolean(currentThumbs[p]);
          });

          if (!hasAnyCachedThumb && childMarkers.length > 0) {
            // Request ONLY ONE photo for the whole cluster!
            const repPath = (childMarkers[0] as any)?.photoPath;
            if (repPath && !currentThumbs[repPath] && !missing.includes(repPath)) {
              missing.push(repPath);
            }
          }
        }
      }

      if (missing.length > 0) {
        onRequestThumbnails(missing);
      }
    } catch {
      // Map may not be ready or bounds invalid
    }
  }, [showThumbnailCards, onRequestThumbnails, map, cluster, photos]);

  // Listen for double click and context menu inside popup cards
  useEffect(() => {
    const container = map.getContainer();

    const handlePopupDblClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const popupCard = target?.closest('[data-photo-path]') as HTMLElement | null;
      if (popupCard) {
        const path = popupCard.getAttribute('data-photo-path');
        if (path) {
          e.preventDefault();
          e.stopPropagation();
          onDoubleClickPhoto(path);
        }
      }
    };

    const handlePopupContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const popupCard = target?.closest('[data-photo-path]') as HTMLElement | null;
      if (popupCard) {
        const path = popupCard.getAttribute('data-photo-path');
        if (path) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenuPhoto(e, path);
        }
      }
    };

    container.addEventListener('dblclick', handlePopupDblClick, true);
    container.addEventListener('contextmenu', handlePopupContextMenu, true);

    return () => {
      container.removeEventListener('dblclick', handlePopupDblClick, true);
      container.removeEventListener('contextmenu', handlePopupContextMenu, true);
    };
  }, [map, onDoubleClickPhoto, onContextMenuPhoto]);

  // Manage markers in cluster reactivity (never out-of-sync)
  useEffect(() => {
    if (!cluster) return;

    const currentThumbs = useProcessStore.getState().thumbnails;
    const currentPaths = new Set(photos.map((p) => p.path));
    const existingMarkers = markersMapRef.current;

    // 1. Remove markers for photos that no longer exist
    const markersToRemove: L.Marker[] = [];
    existingMarkers.forEach((marker, path) => {
      if (!currentPaths.has(path)) {
        markersToRemove.push(marker);
        existingMarkers.delete(path);
      }
    });
    if (markersToRemove.length > 0) {
      cluster.removeLayers(markersToRemove);
    }

    // 2. Add markers for photos not yet inside the cluster
    const markersToAdd: L.Marker[] = [];
    photos.forEach((photo) => {
      let marker = existingMarkers.get(photo.path);

      if (!marker) {
        const isSelected = selectedPath === photo.path;
        const cachedThumb = currentThumbs[photo.path];

        const icon = !showThumbnailCards
          ? createCustomPin(isSelected, photo.isRaw)
          : cachedThumb
            ? createPhotoThumbnailPin(cachedThumb, isSelected, photo.isRaw, photo.filename)
            : createThumbnailLoadingPin(isSelected, photo.isRaw, photo.filename);

        marker = L.marker([photo.lat, photo.lon], {
          icon,
          title: photo.filename,
        });
        (marker as any).photoPath = photo.path;

        marker.bindPopup(buildPopupHtml(photo, cachedThumb, dblClickHint), {
          closeButton: true,
          autoPan: true,
          maxWidth: 540,
          minWidth: 440,
        });

        marker.on('click', (e: L.LeafletMouseEvent) => {
          onSelectPhoto(photo.path, e.originalEvent);
          if (!useProcessStore.getState().thumbnails[photo.path] && onRequestThumbnails) {
            onRequestThumbnails([photo.path]);
          }
        });

        marker.on('dblclick', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e);
          onDoubleClickPhoto(photo.path);
        });

        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e);
          onContextMenuPhoto(e.originalEvent, photo.path);
        });

        existingMarkers.set(photo.path, marker);
      } else {
        (marker as any).photoPath = photo.path;
      }

      if (!cluster.hasLayer(marker)) {
        markersToAdd.push(marker);
      }
    });

    if (markersToAdd.length > 0) {
      cluster.addLayers(markersToAdd);
    }

    // 3. Initial fit bounds ONLY ONCE per folder open
    if (!hasInitialFitRef.current && photos.length > 0) {
      hasInitialFitRef.current = true;
      try {
        const latLngs = photos.map((p) => [p.lat, p.lon] as [number, number]);
        const bounds = L.latLngBounds(latLngs);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
      } catch (e) {
        console.error('Failed to fit bounds', e);
      }
    }
  }, [
    cluster,
    photos,
    onSelectPhoto,
    onDoubleClickPhoto,
    onContextMenuPhoto,
    onRequestThumbnails,
    map,
    dblClickHint,
    showThumbnailCards,
  ]);

  // Debounced listener to request thumbnails only for visible standalone pins
  useEffect(() => {
    if (!showThumbnailCards || !cluster) return;

    const debouncedReq = debounce(requestVisibleThumbnails, 250);
    map.on('moveend', debouncedReq);
    map.on('zoomend', debouncedReq);
    cluster.on('animationend', debouncedReq);
    cluster.on('spiderfied', debouncedReq);

    const timer = setTimeout(requestVisibleThumbnails, 400);

    return () => {
      map.off('moveend', debouncedReq);
      map.off('zoomend', debouncedReq);
      cluster.off('animationend', debouncedReq);
      cluster.off('spiderfied', debouncedReq);
      clearTimeout(timer);
      debouncedReq.cancel();
    };
  }, [map, cluster, showThumbnailCards, requestVisibleThumbnails]);

  // Update individual markers and clusters that receive a new thumbnail (O(1) per arriving thumb)
  useEffect(() => {
    if (!showThumbnailCards) return;

    const newlyAdded: string[] = [];
    for (const path in thumbnails) {
      if (!prevThumbnailsKeysRef.current.has(path)) {
        prevThumbnailsKeysRef.current.add(path);
        newlyAdded.push(path);
      }
    }

    if (newlyAdded.length === 0) return;

    const markersToRefresh: L.Marker[] = [];
    for (const path of newlyAdded) {
      const marker = markersMapRef.current.get(path);
      const photo = photos.find((p) => p.path === path);
      if (marker && photo) {
        const thumbUrl = thumbnails[path];
        const isSelected = selectedPath === path;
        marker.setIcon(createPhotoThumbnailPin(thumbUrl, isSelected, photo.isRaw, photo.filename));
        marker.setPopupContent(buildPopupHtml(photo, thumbUrl, dblClickHint));
        markersToRefresh.push(marker);
      }
    }

    if (cluster && markersToRefresh.length > 0) {
      try {
        cluster.refreshClusters(markersToRefresh);
      } catch {
        cluster.refreshClusters();
      }
    }
  }, [thumbnails, showThumbnailCards, photos, selectedPath, dblClickHint, cluster]);

  // Toggle between Compact Pins and Thumbnail Cards without rebuilding cluster
  useEffect(() => {
    markersMapRef.current.forEach((marker, path) => {
      const photo = photos.find((p) => p.path === path);
      if (!photo) return;

      const isSelected = selectedPath === path;
      if (!showThumbnailCards) {
        marker.setIcon(createCustomPin(isSelected, photo.isRaw));
      } else {
        const thumb = thumbnails[path];
        marker.setIcon(
          thumb
            ? createPhotoThumbnailPin(thumb, isSelected, photo.isRaw, photo.filename)
            : createThumbnailLoadingPin(isSelected, photo.isRaw, photo.filename),
        );
      }
    });

    if (cluster) {
      cluster.refreshClusters();
    }
  }, [showThumbnailCards, photos, selectedPath, thumbnails, cluster]);

  // Highlight and smooth flyTo selected photo
  useEffect(() => {
    // Un-highlight previous
    if (prevSelectedPathRef.current && prevSelectedPathRef.current !== selectedPath) {
      const prevMarker = markersMapRef.current.get(prevSelectedPathRef.current);
      const prevPhoto = photos.find((p) => p.path === prevSelectedPathRef.current);
      if (prevMarker && prevPhoto) {
        const thumb = thumbnails[prevSelectedPathRef.current];
        prevMarker.setIcon(
          showThumbnailCards && thumb
            ? createPhotoThumbnailPin(thumb, false, prevPhoto.isRaw, prevPhoto.filename)
            : showThumbnailCards
              ? createThumbnailLoadingPin(false, prevPhoto.isRaw, prevPhoto.filename)
              : createCustomPin(false, prevPhoto.isRaw),
        );
      }
    }

    prevSelectedPathRef.current = selectedPath;

    if (!selectedPath) return;

    const marker = markersMapRef.current.get(selectedPath);
    const photo = photos.find((p) => p.path === selectedPath);

    if (marker && photo) {
      const thumb = thumbnails[selectedPath];
      marker.setIcon(
        showThumbnailCards && thumb
          ? createPhotoThumbnailPin(thumb, true, photo.isRaw, photo.filename)
          : showThumbnailCards
            ? createThumbnailLoadingPin(true, photo.isRaw, photo.filename)
            : createCustomPin(true, photo.isRaw),
      );
      marker.openPopup();

      map.flyTo([photo.lat, photo.lon], Math.max(map.getZoom(), 15), {
        duration: 0.8,
      });
    }
  }, [selectedPath, photos, map, showThumbnailCards, thumbnails]);

  return null;
};

interface MapControlsProps {
  onFitBounds: () => void;
  tileStyle: MapStyle;
  onTileStyleChange: (style: MapStyle) => void;
  showThumbnailCards: boolean;
  onToggleThumbnailCards: () => void;
}

const MapControls: React.FC<MapControlsProps> = ({
  onFitBounds,
  tileStyle,
  onTileStyleChange,
  showThumbnailCards,
  onToggleThumbnailCards,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="absolute top-4 right-4 z-[1000] flex flex-col items-end gap-2">
      <button
        onClick={onFitBounds}
        className="w-9 h-9 rounded-lg bg-surface/90 hover:bg-surface border border-border-color/30 text-text-secondary hover:text-text-primary flex items-center justify-center shadow-lg backdrop-blur-sm transition active:scale-95"
        title={t('library.map.fitBounds', { defaultValue: 'Inquadra tutte le foto' })}
      >
        <Maximize2 className="w-4 h-4" />
      </button>

      {/* Toggle Thumbnails Card vs Compact Pin */}
      <button
        onClick={onToggleThumbnailCards}
        className={`w-9 h-9 rounded-lg border flex items-center justify-center shadow-lg backdrop-blur-sm transition active:scale-95 ${
          showThumbnailCards
            ? 'bg-accent/20 border-accent text-accent shadow-accent/20'
            : 'bg-surface/90 hover:bg-surface border-border-color/30 text-text-secondary hover:text-text-primary'
        }`}
        title={
          showThumbnailCards
            ? t('library.map.cardsActive', {
                defaultValue: 'Miniature fotografiche attive (clicca per segnaposto compatti)',
              })
            : t('library.map.pinsActive', { defaultValue: 'Segnaposto compatti (clicca per miniature)' })
        }
      >
        <ImageIcon className="w-4 h-4" />
      </button>

      {/* Basemap Selection */}
      <div className="relative">
        <button
          onClick={() => setShowMenu((prev) => !prev)}
          className={`w-9 h-9 rounded-lg border flex items-center justify-center shadow-lg backdrop-blur-sm transition active:scale-95 ${
            showMenu
              ? 'bg-accent border-accent text-button-text'
              : 'bg-surface/90 hover:bg-surface border-border-color/30 text-text-secondary hover:text-text-primary'
          }`}
          title={t('library.map.styleSelector', { defaultValue: 'Seleziona stile mappa' })}
        >
          <Layers className="w-4 h-4" />
        </button>

        {showMenu && (
          <div className="absolute right-0 top-11 w-44 bg-surface/95 border border-border-color/40 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md z-[1001]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary px-2 py-1">
              {t('library.map.mapStyle', { defaultValue: 'Stile Mappa' })}
            </span>
            {(Object.values(MAP_LAYERS) as MapLayerConfig[]).map((layer) => (
              <button
                key={layer.id}
                onClick={() => {
                  onTileStyleChange(layer.id);
                  setShowMenu(false);
                }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition text-left ${
                  tileStyle === layer.id
                    ? 'bg-accent/20 text-accent border border-accent/40 font-medium'
                    : 'text-text-primary hover:bg-hover-color border border-transparent'
                }`}
              >
                <span>{layer.icon}</span>
                <span>{layer.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export interface MapViewProps {
  imageList: Array<ImageFile>;
  activePath: string | null;
  multiSelectedPaths: Array<string>;
  currentFolderPath?: string | null;
  onImageClick(path: string, event: React.MouseEvent | MouseEvent): void;
  onImageDoubleClick(path: string): void;
  onContextMenu(event: React.MouseEvent | MouseEvent, path: string): void;
  onEmptyAreaContextMenu?(event: React.MouseEvent | MouseEvent): void;
  onRequestThumbnails?(paths: string[]): void;
}

export default function MapView(props: MapViewProps) {
  const [tileStyle, setTileStyle] = useState<MapStyle>(getInitialMapStyle);
  const [showThumbnailCards, setShowThumbnailCards] = useState<boolean>(getInitialShowThumbnails);
  const [localExifMap, setLocalExifMap] = useState<Record<string, Record<string, string>>>({});
  const requestedExifRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<L.Map | null>(null);
  const { t } = useTranslation();

  const handleTileStyleChange = useCallback((style: MapStyle) => {
    setTileStyle(style);
    try {
      localStorage.setItem(MAP_STYLE_STORAGE_KEY, style);
    } catch (e) {
      console.error('Failed to save map style to localStorage', e);
    }
  }, []);

  const handleToggleThumbnailCards = useCallback(() => {
    setShowThumbnailCards((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MAP_SHOW_THUMBNAILS_STORAGE_KEY, String(next));
      } catch (e) {
        console.error('Failed to save show thumbnails setting to localStorage', e);
      }
      return next;
    });
  }, []);

  const {
    imageList,
    activePath,
    currentFolderPath,
    onImageClick,
    onImageDoubleClick,
    onContextMenu,
    onRequestThumbnails,
  } = props;

  // Reset EXIF request tracking when switching folders
  useEffect(() => {
    requestedExifRef.current.clear();
    setLocalExifMap({});
  }, [currentFolderPath]);

  // Non-blocking, smooth EXIF ingestion without continuous UI re-sorting loops
  useEffect(() => {
    const unrequested = imageList.filter(
      (img) => !img.exif && !localExifMap[img.path] && !requestedExifRef.current.has(img.path),
    );
    if (unrequested.length === 0) return;

    unrequested.forEach((img) => requestedExifRef.current.add(img.path));

    let isCancelled = false;
    const loadExif = async () => {
      const chunkSize = 100;
      const accumulatedUpdates: Record<string, Record<string, string>> = {};

      for (let i = 0; i < unrequested.length; i += chunkSize) {
        if (isCancelled) break;
        const chunk = unrequested.slice(i, i + chunkSize).map((img) => img.path);
        try {
          const chunkExif = await invoke<Record<string, Record<string, string>>>(
            Invokes.ReadExifForPaths,
            { paths: chunk },
          );
          if (isCancelled) break;

          // 1. Immediately update local map view state so pins appear smoothly
          setLocalExifMap((prev) => ({ ...prev, ...chunkExif }));
          Object.assign(accumulatedUpdates, chunkExif);
        } catch (err) {
          console.error('Failed to read EXIF for MapView:', err);
        }
      }

      // 2. Perform a single batch update to RapidRAW's library store at the end
      if (!isCancelled && Object.keys(accumulatedUpdates).length > 0) {
        useLibraryStore.getState().setLibrary((state) => ({
          imageList: state.imageList.map((img) =>
            accumulatedUpdates[img.path] ? { ...img, exif: accumulatedUpdates[img.path] } : img,
          ),
        }));
      }
    };

    loadExif();
    return () => {
      isCancelled = true;
    };
  }, [imageList.length, currentFolderPath]);

  // Extract photos with valid GPS coordinates (reactive to imageList and localExifMap)
  const { geotaggedPhotos, totalPhotos, geotaggedCount } = useMemo(() => {
    const items: MapPhotoItem[] = [];
    for (const img of imageList) {
      const exifOverride = localExifMap[img.path];
      const gps: GeoLocation | null = getImageGps(img, exifOverride);
      if (gps) {
        const filename = img.path.split(/[\\/]/).pop() || '';
        const timestamp = getImageTimestamp(img, exifOverride);
        items.push({
          id: img.path,
          path: img.path,
          filename,
          lat: gps.lat,
          lon: gps.lon,
          timestamp,
          isRaw: img.is_raw,
          image: img,
        });
      }
    }
    return {
      geotaggedPhotos: items,
      totalPhotos: imageList.length,
      geotaggedCount: items.length,
    };
  }, [imageList, localExifMap]);

  const activeLayer = MAP_LAYERS[tileStyle] || MAP_LAYERS.dark;

  const handleFitBounds = useCallback(() => {
    if (!mapRef.current || geotaggedPhotos.length === 0) return;
    try {
      const latLngs = geotaggedPhotos.map((p) => [p.lat, p.lon] as [number, number]);
      const bounds = L.latLngBounds(latLngs);
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
    } catch (e) {
      console.error('Failed to fit bounds', e);
    }
  }, [geotaggedPhotos]);

  return (
    <div className="relative w-full h-full bg-bg-primary overflow-hidden select-none">
      {/* Geotagged Info Badge on Map */}
      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-2 bg-surface/90 border border-border-color/30 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-lg">
        <MapPin className="w-4 h-4 text-accent shrink-0" />
        <span className="text-xs font-medium text-text-primary">
          {t('library.map.badge', {
            count: geotaggedCount,
            total: totalPhotos,
            defaultValue: `${geotaggedCount} / ${totalPhotos} con coordinate GPS`,
          })}
        </span>
      </div>

      {/* No GPS Warning overlay if folder has photos but none have GPS */}
      {geotaggedCount === 0 && totalPhotos > 0 && (
        <div className="absolute inset-0 z-[999] pointer-events-none flex items-center justify-center">
          <div className="bg-surface/95 border border-border-color/40 backdrop-blur-md p-6 rounded-xl shadow-2xl text-center max-w-sm">
            <MapPin className="w-8 h-8 text-text-secondary mx-auto mb-2 opacity-60" />
            <p className="text-sm font-semibold text-text-primary mb-1">
              {t('library.map.noGpsTitle', { defaultValue: 'Nessuna coordinata GPS' })}
            </p>
            <p className="text-xs text-text-secondary">
              {t('library.map.noGpsDesc', {
                defaultValue:
                  'Nessuna delle foto in questa cartella contiene informazioni geografiche nei metadati EXIF.',
              })}
            </p>
          </div>
        </div>
      )}

      {/* Leaflet Map Container */}
      <MapContainer center={[20, 0]} zoom={2} className="w-full h-full" ref={mapRef} attributionControl={true}>
        <TileLayer
          key={activeLayer.id}
          attribution={activeLayer.attribution}
          url={activeLayer.url}
          className={activeLayer.className}
          maxZoom={activeLayer.maxZoom}
        />

        <PhotoClusterLayer
          photos={geotaggedPhotos}
          selectedPath={activePath}
          currentFolderPath={currentFolderPath}
          onSelectPhoto={onImageClick}
          onDoubleClickPhoto={onImageDoubleClick}
          onContextMenuPhoto={onContextMenu}
          showThumbnailCards={showThumbnailCards}
          onRequestThumbnails={onRequestThumbnails}
        />
      </MapContainer>

      {/* Map Controls */}
      <MapControls
        onFitBounds={handleFitBounds}
        tileStyle={tileStyle}
        onTileStyleChange={handleTileStyleChange}
        showThumbnailCards={showThumbnailCards}
        onToggleThumbnailCards={handleToggleThumbnailCards}
      />
    </div>
  );
}
