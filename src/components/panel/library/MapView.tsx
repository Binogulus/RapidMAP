import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from '../../../utils/leaflet-setup';
import 'leaflet.markercluster';
import { invoke } from '@tauri-apps/api/core';
import {
  Maximize2,
  Layers,
  Image as ImageIcon,
  MapPin,
  MapPinOff,
  PanelRightClose,
  PanelRightOpen,
  CheckCircle2,
  GripVertical,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import debounce from 'lodash.debounce';
import { ImageFile, Invokes } from '../../ui/AppProperties';
import { useProcessStore } from '../../../store/useProcessStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useEditorStore } from '../../../store/useEditorStore';
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
const MAP_DOCK_OPEN_STORAGE_KEY = 'rapidraw_map_dock_open';
const MAP_DOCK_WIDTH_STORAGE_KEY = 'rapidraw_map_dock_width';

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

function getInitialDockOpen(): boolean {
  try {
    const saved = localStorage.getItem(MAP_DOCK_OPEN_STORAGE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch (e) {
    console.error('Failed to read dock open setting from localStorage', e);
  }
  return true;
}

function getInitialDockWidth(): number {
  try {
    const saved = localStorage.getItem(MAP_DOCK_WIDTH_STORAGE_KEY);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 180 && parsed <= 450) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to read dock width setting from localStorage', e);
  }
  return 250;
}

function toDmsString(val: number): string {
  const absVal = Math.abs(val);
  const deg = Math.floor(absVal);
  const minFull = (absVal - deg) * 60;
  const min = Math.floor(minFull);
  const sec = (minFull - min) * 60;
  return `${deg} deg ${min} min ${sec.toFixed(4)} sec`;
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
    }; cursor: grab;">
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
    <div style="position: relative; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); transform: ${scale}; cursor: grab; display: flex; flex-direction: column; align-items: center;">
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
    <div style="position: relative; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); transform: ${scale}; cursor: grab; display: flex; flex-direction: column; align-items: center;">
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

function buildPopupHtml(
  photo: MapPhotoItem,
  thumbUrl: string | undefined,
  dblClickHint: string,
  removeGpsText: string,
  dragHintText: string,
): string {
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

      <div style="display: flex; align-items: center; gap: 6px; color: #38bdf8; font-family: monospace; font-size: 12px; margin-bottom: 4px;">
        <span>📍 ${photo.lat.toFixed(6)}°, ${photo.lon.toFixed(6)}°</span>
      </div>

      <div style="display: flex; align-items: center; gap: 5px; color: #94a3b8; font-size: 11px; margin-bottom: 8px; opacity: 0.85;">
        <span>✋ ${dragHintText}</span>
      </div>

      <div style="color: #64748b; font-size: 11px; word-break: break-all; margin-bottom: 8px;">
        ${photo.path}
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #334155; padding-top: 8px; gap: 8px;">
        <span style="font-size: 11px; color: #38bdf8; opacity: 0.9;">
          ${dblClickHint}
        </span>
        <button
          data-action="remove-gps"
          data-path="${photo.path}"
          style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 4px; padding: 3px 8px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;"
          title="${removeGpsText}"
        >
          🗑️ ${removeGpsText}
        </button>
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
  onRemoveGps?: (path: string) => void;
  onMovePhoto?: (path: string, lat: number, lon: number) => void;
  onMapContextMenu?: (lat: number, lon: number, screenX: number, screenY: number) => void;
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
  onRemoveGps,
  onMovePhoto,
  onMapContextMenu,
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
  const removeGpsText = t('library.map.removeGps', {
    defaultValue: 'Rimuovi GPS',
  });
  const dragHintText = t('library.map.dragToReposition', {
    defaultValue: 'Trascina il segnaposto per riposizionare',
  });

  const onRemoveGpsRef = useRef(onRemoveGps);
  useEffect(() => {
    onRemoveGpsRef.current = onRemoveGps;
  }, [onRemoveGps]);

  const onMovePhotoRef = useRef(onMovePhoto);
  useEffect(() => {
    onMovePhotoRef.current = onMovePhoto;
  }, [onMovePhoto]);

  const onMapContextMenuRef = useRef(onMapContextMenu);
  useEffect(() => {
    onMapContextMenuRef.current = onMapContextMenu;
  }, [onMapContextMenu]);

  // Attach popup click handler for removing GPS and map contextmenu handler
  useEffect(() => {
    const handlePopupOpen = (e: L.PopupEvent) => {
      const el = e.popup.getElement();
      if (!el) return;
      const btn = el.querySelector<HTMLButtonElement>('[data-action="remove-gps"]');
      if (btn) {
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const p = btn.getAttribute('data-path');
          if (p && onRemoveGpsRef.current) {
            onRemoveGpsRef.current(p);
            map.closePopup();
          }
        };
      }
    };

    const handleContextMenu = (e: L.LeafletMouseEvent) => {
      if (onMapContextMenuRef.current) {
        onMapContextMenuRef.current(
          e.latlng.lat,
          ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180,
          e.originalEvent.clientX,
          e.originalEvent.clientY,
        );
      }
    };

    map.on('popupopen', handlePopupOpen);
    map.on('contextmenu', handleContextMenu);
    return () => {
      map.off('popupopen', handlePopupOpen);
      map.off('contextmenu', handleContextMenu);
    };
  }, [map]);

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
          draggable: true,
          autoPan: true,
        });
        (marker as any).photoPath = photo.path;

        marker.bindPopup(buildPopupHtml(photo, cachedThumb, dblClickHint, removeGpsText, dragHintText), {
          closeButton: true,
          autoPan: true,
          maxWidth: 540,
          minWidth: 440,
        });

        marker.on('dragstart', () => {
          map.closePopup();
        });

        marker.on('dragend', (e: L.LeafletEvent) => {
          const target = e.target as L.Marker;
          const newLatLng = target.getLatLng();
          const lat = newLatLng.lat;
          const lon = ((((newLatLng.lng + 180) % 360) + 360) % 360) - 180;
          if (onMovePhotoRef.current) {
            onMovePhotoRef.current(photo.path, lat, lon);
          }
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
        const curLatLng = marker.getLatLng();
        if (
          Math.abs(curLatLng.lat - photo.lat) > 1e-6 ||
          Math.abs(curLatLng.lng - photo.lon) > 1e-6
        ) {
          cluster.removeLayer(marker);
          marker.setLatLng([photo.lat, photo.lon]);
          cluster.addLayer(marker);
        }
        const cachedThumb = currentThumbs[photo.path];
        marker.setPopupContent(
          buildPopupHtml(photo, cachedThumb, dblClickHint, removeGpsText, dragHintText),
        );
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
    removeGpsText,
    dragHintText,
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
        marker.setPopupContent(
          buildPopupHtml(photo, thumbUrl, dblClickHint, removeGpsText, dragHintText),
        );
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
  }, [
    thumbnails,
    showThumbnailCards,
    photos,
    selectedPath,
    dblClickHint,
    removeGpsText,
    dragHintText,
    cluster,
  ]);

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

interface UnlocatedPhotoCardProps {
  photo: ImageFile;
  filename: string;
  ext: string;
  timestamp: string | null;
  thumbUrl?: string;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onRequestThumb: (path: string) => void;
}

const UnlocatedPhotoCard: React.FC<UnlocatedPhotoCardProps> = React.memo(
  ({
    photo,
    filename,
    ext,
    timestamp,
    thumbUrl,
    isSelected,
    onSelect,
    onDragStart,
    onRequestThumb,
  }) => {
    useEffect(() => {
      if (!thumbUrl) {
        onRequestThumb(photo.path);
      }
    }, [photo.path, thumbUrl, onRequestThumb]);

    return (
      <div
        draggable={true}
        onDragStart={onDragStart}
        onClick={onSelect}
        className={`group relative flex items-center gap-2.5 p-2 rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none ${
          isSelected
            ? 'bg-accent/15 border-accent shadow-md ring-1 ring-accent/60'
            : 'bg-surface/50 hover:bg-surface border-border-color/30 hover:border-border-color/60'
        }`}
      >
        <div className="w-14 h-14 rounded-lg bg-bg-primary overflow-hidden shrink-0 border border-border-color/30 flex items-center justify-center relative">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={filename}
              className="w-full h-full object-cover select-none pointer-events-none"
              loading="lazy"
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-text-secondary opacity-40" />
          )}
          <span
            className={`absolute bottom-0.5 right-0.5 text-[9px] font-black px-1 rounded uppercase tracking-tighter ${
              photo.is_raw
                ? 'bg-amber-950/90 text-amber-300 border border-amber-600/60'
                : 'bg-sky-950/90 text-sky-300 border border-sky-600/60'
            }`}
          >
            {ext || (photo.is_raw ? 'RAW' : 'IMG')}
          </span>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="text-xs font-semibold text-text-primary truncate block" title={filename}>
            {filename}
          </span>
          {timestamp && (
            <span className="text-[10px] text-text-secondary truncate block mt-0.5 opacity-80">
              {timestamp}
            </span>
          )}
          <span className="text-[10px] text-accent/80 flex items-center gap-1 mt-1 font-medium group-hover:text-accent">
            <GripVertical className="w-3 h-3 shrink-0" />
            <span>Trascina sulla mappa</span>
          </span>
        </div>
      </div>
    );
  },
);

interface MapControlsProps {
  onFitBounds: () => void;
  tileStyle: MapStyle;
  onTileStyleChange: (style: MapStyle) => void;
  showThumbnailCards: boolean;
  onToggleThumbnailCards: () => void;
  isDockOpen: boolean;
  onToggleDock: () => void;
  unlocatedCount: number;
}

const MapControls: React.FC<MapControlsProps> = ({
  onFitBounds,
  tileStyle,
  onTileStyleChange,
  showThumbnailCards,
  onToggleThumbnailCards,
  isDockOpen,
  onToggleDock,
  unlocatedCount,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="absolute top-4 right-4 z-[1000] flex flex-col items-end gap-2">
      {/* Toggle Unlocated Photos Dock */}
      <button
        onClick={onToggleDock}
        className={`w-9 h-9 rounded-lg border flex items-center justify-center shadow-lg backdrop-blur-sm transition active:scale-95 relative ${
          isDockOpen
            ? 'bg-accent/20 border-accent text-accent shadow-accent/20'
            : 'bg-surface/90 hover:bg-surface border-border-color/30 text-text-secondary hover:text-text-primary'
        }`}
        title={t('library.map.toggleDock', {
          defaultValue: 'Pannello foto non geolocalizzate',
        })}
      >
        <MapPinOff className="w-4 h-4" />
        {unlocatedCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.2 rounded-full leading-tight shadow-md">
            {unlocatedCount > 99 ? '99+' : unlocatedCount}
          </span>
        )}
      </button>

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
  const [isDockOpen, setIsDockOpen] = useState<boolean>(getInitialDockOpen);
  const [dockWidth, setDockWidth] = useState<number>(getInitialDockWidth);
  const [selectedDockPaths, setSelectedDockPaths] = useState<Set<string>>(new Set());
  const [isDraggingOverMap, setIsDraggingOverMap] = useState<boolean>(false);
  const [mapContextMenu, setMapContextMenu] = useState<{
    x: number;
    y: number;
    lat: number;
    lon: number;
    targetPaths: string[];
  } | null>(null);

  const [localExifMap, setLocalExifMap] = useState<Record<string, Record<string, string>>>({});
  const requestedExifRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<L.Map | null>(null);
  const isResizing = useRef(false);
  const thumbnails = useProcessStore((s) => s.thumbnails);
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

  const handleToggleDock = useCallback(() => {
    setIsDockOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MAP_DOCK_OPEN_STORAGE_KEY, String(next));
      } catch (e) {
        console.error('Failed to save dock open setting to localStorage', e);
      }
      return next;
    });
  }, []);

  // Invalidate Leaflet size whenever dock width or open state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 220);
    return () => clearTimeout(timer);
  }, [isDockOpen, dockWidth]);

  // Dock Resizing Handlers
  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - mouseMoveEvent.clientX;
    if (newWidth >= 180 && newWidth <= 450) {
      setDockWidth(newWidth);
      try {
        localStorage.setItem(MAP_DOCK_WIDTH_STORAGE_KEY, String(newWidth));
      } catch (e) {
        console.error('Failed to save dock width to localStorage', e);
      }
      mapRef.current?.invalidateSize();
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResizing);
    mapRef.current?.invalidateSize();
  }, [resize]);

  const startResizing = useCallback(
    (mouseDownEvent: React.MouseEvent) => {
      mouseDownEvent.preventDefault();
      isResizing.current = true;
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResizing);
    },
    [resize, stopResizing],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  // Close context menu on outside click
  useEffect(() => {
    const handleWindowClick = () => setMapContextMenu(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const {
    imageList,
    activePath,
    multiSelectedPaths,
    currentFolderPath,
    onImageClick,
    onImageDoubleClick,
    onContextMenu,
    onRequestThumbnails,
  } = props;

  // Thumbnail batch queue
  const requestQueueRef = useRef<Set<string>>(new Set());
  const requestTimeoutRef = useRef<any>(null);

  const queueThumbnailRequest = useCallback(
    (path: string) => {
      if (!onRequestThumbnails) return;
      if (useProcessStore.getState().thumbnails[path]) return;
      requestQueueRef.current.add(path);
      if (!requestTimeoutRef.current) {
        requestTimeoutRef.current = setTimeout(() => {
          const paths = Array.from(requestQueueRef.current);
          if (paths.length > 0) {
            onRequestThumbnails(paths);
            requestQueueRef.current.clear();
          }
          requestTimeoutRef.current = null;
        }, 50);
      }
    },
    [onRequestThumbnails],
  );

  // Reset EXIF request tracking when switching folders
  useEffect(() => {
    requestedExifRef.current.clear();
    setLocalExifMap({});
    setSelectedDockPaths(new Set());
    setMapContextMenu(null);
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

          setLocalExifMap((prev) => ({ ...prev, ...chunkExif }));
          Object.assign(accumulatedUpdates, chunkExif);
        } catch (err) {
          console.error('Failed to read EXIF for MapView:', err);
        }
      }

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

  // Compute Geotagged and Unlocated photos
  const { geotaggedPhotos, unlocatedPhotos, totalPhotos, geotaggedCount } = useMemo(() => {
    const items: MapPhotoItem[] = [];
    const unlocated: ImageFile[] = [];

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
      } else {
        unlocated.push(img);
      }
    }
    return {
      geotaggedPhotos: items,
      unlocatedPhotos: unlocated,
      totalPhotos: imageList.length,
      geotaggedCount: items.length,
    };
  }, [imageList, localExifMap]);

  // Apply or remove GPS coordinates to sidecars and state
  const applyGpsToPhotos = useCallback(
    async (paths: string[], lat: number | null, lon: number | null) => {
      if (paths.length === 0) return;
      try {
        await invoke(Invokes.SetGpsForPaths, {
          paths,
          latitude: lat,
          longitude: lon,
        });

        const updates: Record<string, string> = {};
        if (lat !== null && lon !== null) {
          updates.GPSLatitude = toDmsString(lat);
          updates.GPSLatitudeRef = lat >= 0 ? 'N' : 'S';
          updates.GPSLongitude = toDmsString(lon);
          updates.GPSLongitudeRef = lon >= 0 ? 'E' : 'W';
        }

        // 1. Immediately update local map view state so pins appear or vanish smoothly
        setLocalExifMap((prev) => {
          const next = { ...prev };
          for (const p of paths) {
            if (lat !== null && lon !== null) {
              next[p] = { ...(next[p] || {}), ...updates };
            } else if (next[p]) {
              const cleaned = { ...next[p] };
              delete cleaned.GPSLatitude;
              delete cleaned.GPSLatitudeRef;
              delete cleaned.GPSLongitude;
              delete cleaned.GPSLongitudeRef;
              next[p] = cleaned;
            }
          }
          return next;
        });

        // 2. Remove geotagged photos from dock selection
        setSelectedDockPaths((prev) => {
          const next = new Set(prev);
          paths.forEach((p) => next.delete(p));
          return next;
        });

        // 3. Update library store imageList
        const pathsSet = new Set(paths.map((p) => p.split('?vc=')[0]));
        useLibraryStore.getState().setLibrary((state) => ({
          imageList: state.imageList.map((img) => {
            if (pathsSet.has(img.path.split('?vc=')[0])) {
              if (lat !== null && lon !== null) {
                return { ...img, exif: { ...(img.exif || {}), ...updates } };
              } else if (img.exif) {
                const cleaned = { ...img.exif };
                delete cleaned.GPSLatitude;
                delete cleaned.GPSLatitudeRef;
                delete cleaned.GPSLongitude;
                delete cleaned.GPSLongitudeRef;
                return { ...img, exif: cleaned };
              }
            }
            return img;
          }),
        }));

        // 4. Update editor store if current image matches
        useEditorStore.getState().setEditor((state) => {
          if (!state.selectedImage || !pathsSet.has(state.selectedImage.path.split('?vc=')[0])) {
            return state;
          }
          if (lat !== null && lon !== null) {
            return {
              selectedImage: {
                ...state.selectedImage,
                exif: { ...(state.selectedImage.exif || {}), ...updates },
              },
            };
          } else if (state.selectedImage.exif) {
            const cleaned = { ...state.selectedImage.exif };
            delete cleaned.GPSLatitude;
            delete cleaned.GPSLatitudeRef;
            delete cleaned.GPSLongitude;
            delete cleaned.GPSLongitudeRef;
            return { selectedImage: { ...state.selectedImage, exif: cleaned } };
          }
          return state;
        });

        if (lat !== null) {
          const hadPreviousGps = paths.some((p) => {
            const img = imageList.find((i) => i.path === p);
            return Boolean(getImageGps(img, localExifMap[p]));
          });

          if (hadPreviousGps) {
            toast.success(
              t('library.map.repositionedSuccess', {
                count: paths.length,
                defaultValue:
                  paths.length === 1
                    ? 'Foto riposizionata con successo'
                    : `${paths.length} foto riposizionate con successo`,
              }),
            );
          } else {
            toast.success(
              t('library.map.geotagSuccess', {
                count: paths.length,
                defaultValue: `Posizionate ${paths.length} foto con successo`,
              }),
            );
          }
        } else {
          toast.info(
            t('library.map.geotagRemoved', {
              count: paths.length,
              defaultValue: `Coordinate GPS rimosse per ${paths.length} foto`,
            }),
          );
        }
      } catch (err) {
        console.error('Failed to set GPS coordinates', err);
        toast.error(`Errore nel salvataggio coordinate: ${err}`);
      }
    },
    [t, imageList, localExifMap],
  );

  // Handle moving / dragging an existing photo pin on the map
  const handleMovePhoto = useCallback(
    async (draggedPath: string, lat: number, lon: number) => {
      let targetPaths = [draggedPath];
      if (multiSelectedPaths.length > 1 && multiSelectedPaths.includes(draggedPath)) {
        targetPaths = multiSelectedPaths;
      }
      await applyGpsToPhotos(targetPaths, lat, lon);
    },
    [multiSelectedPaths, applyGpsToPhotos],
  );

  // Handle Drop on Leaflet Map
  const handleMapDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOverMap(false);
      if (!mapRef.current) return;

      try {
        const rawData =
          e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
        if (!rawData) return;
        const parsed = JSON.parse(rawData);
        const pathsToGeotag: string[] = Array.isArray(parsed?.paths) ? parsed.paths : [];
        if (pathsToGeotag.length === 0) return;

        const container = mapRef.current.getContainer();
        const rect = container.getBoundingClientRect();
        const point = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const latLng = mapRef.current.containerPointToLatLng(point);

        const lat = latLng.lat;
        let lon = ((((latLng.lng + 180) % 360) + 360) % 360) - 180;

        await applyGpsToPhotos(pathsToGeotag, lat, lon);

        // Smoothly pan map to drop location
        mapRef.current.panTo([lat, lon], { animate: true, duration: 0.4 });
      } catch (err) {
        console.error('Failed to handle drop on map', err);
      }
    },
    [applyGpsToPhotos],
  );

  // Handle right-click on map to position selected photos
  const handleMapRightClick = useCallback(
    (lat: number, lon: number, screenX: number, screenY: number) => {
      const targetPaths =
        selectedDockPaths.size > 0
          ? Array.from(selectedDockPaths)
          : multiSelectedPaths.length > 0
            ? multiSelectedPaths
            : activePath
              ? [activePath]
              : [];

      if (targetPaths.length > 0) {
        setMapContextMenu({
          x: screenX,
          y: screenY,
          lat,
          lon,
          targetPaths,
        });
      }
    },
    [selectedDockPaths, multiSelectedPaths, activePath],
  );

  // Photo selection in dock
  const handlePhotoSelect = useCallback((path: string, e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelectedDockPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    } else {
      setSelectedDockPaths(new Set([path]));
    }
  }, []);

  // Photo drag start from dock
  const handlePhotoDragStart = useCallback(
    (photo: ImageFile, e: React.DragEvent) => {
      const pathsToDrag =
        selectedDockPaths.has(photo.path) && selectedDockPaths.size > 1
          ? Array.from(selectedDockPaths)
          : [photo.path];

      e.dataTransfer.setData('application/json', JSON.stringify({ paths: pathsToDrag }));
      e.dataTransfer.setData('text/plain', JSON.stringify({ paths: pathsToDrag }));
      e.dataTransfer.effectAllowed = 'copyMove';

      const ghost = document.createElement('div');
      ghost.style.padding = '6px 14px';
      ghost.style.background = '#0284c7';
      ghost.style.color = '#ffffff';
      ghost.style.fontSize = '12px';
      ghost.style.fontWeight = '700';
      ghost.style.borderRadius = '8px';
      ghost.style.boxShadow = '0 6px 16px rgba(0,0,0,0.6)';
      ghost.style.border = '1px solid #38bdf8';
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      ghost.innerText =
        pathsToDrag.length > 1
          ? `📍 ${pathsToDrag.length} foto`
          : `📍 ${photo.path.split(/[\\/]/).pop()}`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 15, 15);
      setTimeout(() => {
        if (document.body.contains(ghost)) {
          document.body.removeChild(ghost);
        }
      }, 0);
    },
    [selectedDockPaths],
  );

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
    <div className="relative flex w-full h-full bg-bg-primary overflow-hidden select-none">
      {/* Left Area: Map Canvas & Controls */}
      <div
        className="flex-1 h-full relative"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!isDraggingOverMap) setIsDraggingOverMap(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) {
            setIsDraggingOverMap(false);
          }
        }}
        onDrop={handleMapDrop}
      >
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

        {/* Drag over map overlay indicator */}
        {isDraggingOverMap && (
          <div className="absolute inset-0 z-[1100] pointer-events-none bg-accent/15 border-2 border-accent border-dashed flex items-center justify-center backdrop-blur-[1px]">
            <div className="bg-surface/95 border border-accent text-text-primary px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 animate-pulse">
              <MapPin className="w-6 h-6 text-accent" />
              <span className="text-sm font-bold">
                {t('library.map.dropToGeotag', { defaultValue: 'Rilascia sulla mappa per posizionare' })}
              </span>
            </div>
          </div>
        )}

        {/* No GPS Warning overlay if folder has photos but none have GPS and dock is closed */}
        {geotaggedCount === 0 && totalPhotos > 0 && !isDockOpen && (
          <div className="absolute inset-0 z-[999] pointer-events-none flex items-center justify-center">
            <div className="bg-surface/95 border border-border-color/40 backdrop-blur-md p-6 rounded-xl shadow-2xl text-center max-w-sm pointer-events-auto">
              <MapPin className="w-8 h-8 text-text-secondary mx-auto mb-2 opacity-60" />
              <p className="text-sm font-semibold text-text-primary mb-1">
                {t('library.map.noGpsTitle', { defaultValue: 'Nessuna coordinata GPS' })}
              </p>
              <p className="text-xs text-text-secondary mb-3">
                {t('library.map.noGpsDesc', {
                  defaultValue:
                    'Nessuna delle foto in questa cartella contiene informazioni geografiche nei metadati EXIF.',
                })}
              </p>
              <button
                onClick={() => setIsDockOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-accent text-button-text text-xs font-semibold shadow hover:opacity-90 transition"
              >
                {t('library.map.toggleDock', { defaultValue: 'Apri pannello per posizionarle' })}
              </button>
            </div>
          </div>
        )}

        {/* Leaflet Map */}
        <MapContainer
          center={[20, 0]}
          zoom={2}
          className="w-full h-full"
          ref={mapRef}
          attributionControl={true}
        >
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
            onRemoveGps={(path) => applyGpsToPhotos([path], null, null)}
            onMovePhoto={handleMovePhoto}
            onMapContextMenu={handleMapRightClick}
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
          isDockOpen={isDockOpen}
          onToggleDock={handleToggleDock}
          unlocatedCount={unlocatedPhotos.length}
        />
      </div>

      {/* Right Dock for Unlocated Photos */}
      <div
        style={{ width: isDockOpen ? dockWidth : 0 }}
        className={`relative shrink-0 border-l border-surface/50 bg-bg-secondary/70 backdrop-blur-md flex flex-col transition-[width] duration-200 ease-out z-[1000] ${
          isDockOpen ? '' : 'overflow-hidden border-none'
        }`}
      >
        {isDockOpen && (
          <>
            {/* Left border resizer handle */}
            <div
              onMouseDown={startResizing}
              className="absolute top-0 bottom-0 left-0 w-1.5 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors z-40"
              title="Trascina per ridimensionare"
            />

            {/* Dock Header */}
            <div className="p-3 border-b border-surface/50 flex flex-col gap-1 shrink-0 bg-surface/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPinOff className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs font-bold text-text-primary uppercase tracking-wide">
                    {t('library.map.unlocatedDockTitle', { defaultValue: 'Senza coordinate' })}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-surface border border-border-color/30 text-text-secondary">
                    {unlocatedPhotos.length}
                  </span>
                </div>
                <button
                  onClick={() => setIsDockOpen(false)}
                  className="w-6 h-6 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface/60 transition"
                  title="Chiudi dock"
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between mt-1 text-[11px] text-text-secondary">
                <span>
                  {t('library.map.unlocatedDockSubtitle', {
                    defaultValue: 'Trascina sulla mappa per posizionare',
                  })}
                </span>
                {unlocatedPhotos.length > 1 && (
                  <button
                    onClick={() => {
                      if (selectedDockPaths.size === unlocatedPhotos.length) {
                        setSelectedDockPaths(new Set());
                      } else {
                        setSelectedDockPaths(new Set(unlocatedPhotos.map((p) => p.path)));
                      }
                    }}
                    className="text-accent hover:underline text-[10px] font-medium shrink-0 ml-2"
                  >
                    {selectedDockPaths.size === unlocatedPhotos.length
                      ? 'Deseleziona'
                      : 'Seleziona tutte'}
                  </button>
                )}
              </div>
            </div>

            {/* Dock Photo List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5 flex flex-col gap-2">
              {unlocatedPhotos.length === 0 ? (
                <div className="m-auto text-center p-6 flex flex-col items-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2 opacity-80" />
                  <p className="text-xs font-semibold text-text-primary">
                    {t('library.map.allGeotagged', {
                      defaultValue: 'Tutte le foto sono geolocalizzate',
                    })}
                  </p>
                </div>
              ) : (
                unlocatedPhotos.map((photo) => {
                  const isSelected = selectedDockPaths.has(photo.path);
                  const thumb = thumbnails[photo.path];
                  const filename = photo.path.split(/[\\/]/).pop() || '';
                  const ext = getFileExtension(filename);
                  const timestamp = getImageTimestamp(photo, localExifMap[photo.path]);

                  return (
                    <UnlocatedPhotoCard
                      key={photo.path}
                      photo={photo}
                      filename={filename}
                      ext={ext}
                      timestamp={timestamp}
                      thumbUrl={thumb}
                      isSelected={isSelected}
                      onSelect={(e) => handlePhotoSelect(photo.path, e)}
                      onDragStart={(e) => handlePhotoDragStart(photo, e)}
                      onRequestThumb={queueThumbnailRequest}
                    />
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating Map Context Menu */}
      {mapContextMenu && (
        <div
          style={{ top: mapContextMenu.y, left: mapContextMenu.x }}
          className="fixed z-[2000] bg-surface/95 border border-border-color/40 rounded-xl shadow-2xl p-1.5 backdrop-blur-md flex flex-col min-w-48 text-xs text-text-primary animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[11px] text-text-secondary border-b border-border-color/20 mb-1 flex items-center gap-1 font-medium">
            <MapPin className="w-3.5 h-3.5 text-accent" />
            <span>
              {mapContextMenu.lat.toFixed(5)}°, {mapContextMenu.lon.toFixed(5)}°
            </span>
          </div>
          {(() => {
            const areTargetsGeotagged = mapContextMenu.targetPaths.some((p) => {
              const img = imageList.find((i) => i.path === p);
              return Boolean(getImageGps(img, localExifMap[p]));
            });

            return (
              <button
                onClick={() => {
                  applyGpsToPhotos(
                    mapContextMenu.targetPaths,
                    mapContextMenu.lat,
                    mapContextMenu.lon,
                  );
                  setMapContextMenu(null);
                }}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-accent/20 hover:text-accent transition font-medium"
              >
                <MapPin className="w-4 h-4 text-accent" />
                <span>
                  {areTargetsGeotagged
                    ? t('library.map.repositionSelectedHere', {
                        count: mapContextMenu.targetPaths.length,
                        defaultValue: `Riposiziona ${mapContextMenu.targetPaths.length} foto qui`,
                      })
                    : t('library.map.geotagSelectedHere', {
                        count: mapContextMenu.targetPaths.length,
                        defaultValue: `Posiziona ${mapContextMenu.targetPaths.length} foto qui`,
                      })}
                </span>
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
