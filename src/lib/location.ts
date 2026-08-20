// Location utilities for geo-fence check

export type GpsCoords = { lat: number; lng: number; accuracy?: number };

let lastFix: { coords: GpsCoords; at: number } | null = null;
let watchId: number | null = null;
const FRESH_MS = 60_000;

/** Keep a warm GPS fix in the background so scans never wait for a cold lock. */
export function warmupLocation(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  if (watchId !== null) return;
  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastFix = {
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
          at: Date.now(),
        };
      },
      () => {},
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30_000 },
    );
  } catch {
    /* ignore */
  }
}

function once(options: PositionOptions): Promise<GpsCoords> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        lastFix = { coords: c, at: Date.now() };
        resolve(c);
      },
      (err) => reject(new Error(`Location error: ${err.message}`)),
      options,
    );
  });
}

/**
 * Instant location: uses the warm/cached fix when it is recent, otherwise asks
 * for a fast low-accuracy fix first and only falls back to a slow precise one.
 */
export async function getCurrentPosition(): Promise<GpsCoords> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("Geolocation is not supported on this device.");
  }
  warmupLocation();
  if (lastFix && Date.now() - lastFix.at < FRESH_MS) return lastFix.coords;
  try {
    // Fast path — cached OS fix, low accuracy, short timeout
    return await once({ enableHighAccuracy: false, timeout: 4000, maximumAge: FRESH_MS });
  } catch {
    return await once({ enableHighAccuracy: true, timeout: 12000, maximumAge: 10_000 });
  }
}

// Haversine distance in meters
export function distanceMeters(a: GpsCoords, b: GpsCoords): number {
  const R = 6371000;
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dphi = ((b.lat - a.lat) * Math.PI) / 180;
  const dlam = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function isWithinFence(
  current: GpsCoords,
  center: GpsCoords,
  radiusMeters: number,
): boolean {
  return distanceMeters(current, center) <= radiusMeters;
}
