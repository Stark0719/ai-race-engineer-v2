"""
Extract Real Circuit Coordinates from FastF1 GPS Telemetry
===========================================================
This script downloads actual F1 telemetry data and extracts
real circuit XY coordinates, corner positions, sector boundaries,
speed profiles, and elevation data.

Run locally with internet access:
    python scripts/extract_tracks.py

Outputs: data/tracks/<circuit_key>.json for each circuit
"""

import fastf1
import numpy as np
import json
import math
from pathlib import Path

# Enable caching to avoid re-downloading
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "tracks"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Circuits to extract: (season, gp_name, circuit_key, display_name, country, total_laps, pit_loss_sec)
CIRCUITS = [
    (2024, "Bahrain", "bahrain", "Bahrain International Circuit", "Bahrain", 57, 21.5),
    (2024, "Saudi Arabia", "jeddah", "Jeddah Corniche Circuit", "Saudi Arabia", 50, 22.0),
    (2024, "Australia", "melbourne", "Albert Park Circuit", "Australia", 58, 23.0),
    (2024, "Japan", "suzuka", "Suzuka International Racing Course", "Japan", 53, 23.5),
    (2024, "China", "shanghai", "Shanghai International Circuit", "China", 56, 22.5),
    (2024, "Miami", "miami", "Miami International Autodrome", "USA", 57, 22.0),
    (2024, "Emilia Romagna", "imola", "Autodromo Enzo e Dino Ferrari", "Italy", 63, 23.0),
    (2024, "Monaco", "monaco", "Circuit de Monaco", "Monaco", 78, 20.0),
    (2024, "Canada", "montreal", "Circuit Gilles Villeneuve", "Canada", 70, 21.0),
    (2024, "Spain", "barcelona", "Circuit de Barcelona-Catalunya", "Spain", 66, 21.5),
    (2024, "Austria", "spielberg", "Red Bull Ring", "Austria", 71, 20.5),
    (2024, "Great Britain", "silverstone", "Silverstone Circuit", "United Kingdom", 52, 20.5),
    (2024, "Hungary", "hungaroring", "Hungaroring", "Hungary", 70, 21.0),
    (2024, "Belgium", "spa", "Circuit de Spa-Francorchamps", "Belgium", 44, 22.0),
    (2024, "Netherlands", "zandvoort", "Circuit Zandvoort", "Netherlands", 72, 19.5),
    (2024, "Italy", "monza", "Autodromo Nazionale Monza", "Italy", 53, 24.0),
    (2024, "Azerbaijan", "baku", "Baku City Circuit", "Azerbaijan", 51, 25.0),
    (2024, "Singapore", "singapore", "Marina Bay Street Circuit", "Singapore", 61, 28.0),
    (2024, "United States", "cota", "Circuit of the Americas", "USA", 56, 22.0),
    (2024, "Mexico", "mexico_city", "Autódromo Hermanos Rodríguez", "Mexico", 71, 22.5),
    (2024, "São Paulo", "interlagos", "Interlagos", "Brazil", 71, 22.0),
    (2024, "Las Vegas", "las_vegas", "Las Vegas Strip Circuit", "USA", 50, 23.0),
    (2024, "Qatar", "lusail", "Lusail International Circuit", "Qatar", 57, 21.5),
    (2024, "Abu Dhabi", "yas_marina", "Yas Marina Circuit", "UAE", 58, 22.0),
]


def extract_circuit(season, gp_name, circuit_key, display_name, country,
                    total_laps, pit_loss_sec, n_resample=600):
    """
    Extract real circuit coordinates from the fastest lap telemetry.
    Returns a dict with all track data needed for simulation.
    """
    print(f"\n{'='*60}")
    print(f"Extracting: {display_name} ({gp_name} {season})")
    print(f"{'='*60}")

    try:
        session = fastf1.get_session(season, gp_name, "R")
        session.load(telemetry=True, weather=False, messages=False)
    except Exception as e:
        print(f"  ERROR loading session: {e}")
        # Try qualifying if race fails
        try:
            session = fastf1.get_session(season, gp_name, "Q")
            session.load(telemetry=True, weather=False, messages=False)
            print(f"  Using qualifying session instead")
        except Exception as e2:
            print(f"  ERROR loading qualifying: {e2}")
            return None

    # Get the fastest lap with telemetry
    laps = session.laps.pick_fastest()
    if laps is None or laps.empty if hasattr(laps, 'empty') else laps is None:
        # Try top 5 drivers
        for drv in session.laps['Driver'].unique()[:5]:
            drv_laps = session.laps.pick_drivers(drv).pick_fastest()
            if drv_laps is not None:
                laps = drv_laps
                break

    if laps is None:
        print(f"  ERROR: No valid lap found")
        return None

    tel = laps.get_telemetry()
    if tel is None or len(tel) == 0:
        print(f"  ERROR: No telemetry data")
        return None

    print(f"  Telemetry points: {len(tel)}")

    # Extract X, Y coordinates (meters, relative to track origin)
    x_raw = tel['X'].values.astype(float)
    y_raw = tel['Y'].values.astype(float)

    # Remove any NaN values
    valid = ~(np.isnan(x_raw) | np.isnan(y_raw))
    x_raw = x_raw[valid]
    y_raw = y_raw[valid]

    if len(x_raw) < 50:
        print(f"  ERROR: Too few valid points ({len(x_raw)})")
        return None

    # Extract speed
    speed_raw = tel['Speed'].values.astype(float)[valid]

    print(f"  Valid GPS points: {len(x_raw)}")
    print(f"  X range: {x_raw.min():.0f} to {x_raw.max():.0f} m")
    print(f"  Y range: {y_raw.min():.0f} to {y_raw.max():.0f} m")

    # Compute cumulative distance
    # Use FastF1 distance for authoritative lap length
    tel = laps.get_telemetry().add_distance()
    total_length = tel['Distance'].iloc[-1]

    # Compute geometric cumulative distance from raw XY
    dx = np.diff(x_raw)
    dy = np.diff(y_raw)
    seg_lengths = np.sqrt(dx**2 + dy**2)
    cum_dist_geom = np.concatenate([[0], np.cumsum(seg_lengths)])

    # Normalize geometric distance to official lap length
    scale_factor = total_length / cum_dist_geom[-1]
    cum_dist = cum_dist_geom * scale_factor

    print(f"  Circuit length: {total_length:.1f} m")

    print(f"  Circuit length: {total_length:.0f} m")

    # Resample uniformly along the track
    target_dists = np.linspace(0, total_length, n_resample, endpoint=False)
    x_resampled = np.interp(target_dists, cum_dist, x_raw)
    y_resampled = np.interp(target_dists, cum_dist, y_raw)
    speed_resampled = np.interp(target_dists, cum_dist, speed_raw)

    # Smooth the coordinates slightly to remove GPS noise
    # Use a small Gaussian kernel
    kernel_size = 5
    kernel = np.ones(kernel_size) / kernel_size
    x_smooth = np.convolve(np.concatenate([x_resampled[-kernel_size:], x_resampled, x_resampled[:kernel_size]]),
                           kernel, mode='valid')[:n_resample]
    y_smooth = np.convolve(np.concatenate([y_resampled[-kernel_size:], y_resampled, y_resampled[:kernel_size]]),
                           kernel, mode='valid')[:n_resample]

    # Compute headings (tangent direction)
    headings = []
    for i in range(n_resample):
        j = (i + 1) % n_resample
        headings.append(math.atan2(y_smooth[j] - y_smooth[i], x_smooth[j] - x_smooth[i]))

    # Unwrap headings for continuity
    headings = np.array(headings)
    headings = np.unwrap(headings)

    # Compute curvature (for corner detection)
    curvature = np.abs(np.diff(headings, prepend=headings[-1]))
    curvature = np.minimum(curvature, 2 * np.pi - curvature)

    # Detect corners (high curvature regions)
    curvature_threshold = np.percentile(curvature, 85)
    corners = []
    in_corner = False
    corner_start = 0
    for i in range(n_resample):
        if curvature[i] > curvature_threshold and not in_corner:
            in_corner = True
            corner_start = i
        elif curvature[i] < curvature_threshold * 0.5 and in_corner:
            in_corner = False
            mid = (corner_start + i) // 2
            corners.append({
                "index": int(mid),
                "fraction": round(mid / n_resample, 4),
                "x": round(float(x_smooth[mid]), 1),
                "y": round(float(y_smooth[mid]), 1),
                "min_speed": round(float(speed_resampled[corner_start:i].min()), 0),
            })

    print(f"  Detected {len(corners)} corners")

    # Sector boundaries (approximate from track thirds)
    # In reality these come from timing sectors, but we approximate
    sector_boundaries = [0.0, 0.33, 0.66, 1.0]

    # Try to get actual sector boundaries from lap data
    try:
        if hasattr(laps, 'Sector1Time') and laps['Sector1Time'] is not None:
            s1 = laps['Sector1Time'].total_seconds() if hasattr(laps['Sector1Time'], 'total_seconds') else float(laps['Sector1Time'])
            s2 = laps['Sector2Time'].total_seconds() if hasattr(laps['Sector2Time'], 'total_seconds') else float(laps['Sector2Time'])
            s3 = laps['Sector3Time'].total_seconds() if hasattr(laps['Sector3Time'], 'total_seconds') else float(laps['Sector3Time'])
            total_time = s1 + s2 + s3
            if total_time > 0:
                sector_boundaries = [0.0, round(s1/total_time, 4), round((s1+s2)/total_time, 4), 1.0]
                print(f"  Sector boundaries: {sector_boundaries}")
    except Exception:
        pass

    # Base lap time
    try:
        base_lap_time = laps['LapTime'].total_seconds()
    except Exception:
        base_lap_time = total_length / 60.0  # rough estimate

    # Build waypoints: (x, y, speed_kph, heading_rad)
    waypoints = []
    for i in range(n_resample):
        waypoints.append([
            round(float(x_smooth[i]), 1),
            round(float(y_smooth[i]), 1),
            round(float(speed_resampled[i]), 0),
            round(float(headings[i]), 6),
        ])

    # Add closure point
    closure_heading = headings[-1]
    dh = math.atan2(y_smooth[0] - y_smooth[-1], x_smooth[0] - x_smooth[-1])
    while dh - closure_heading > math.pi: dh -= 2 * math.pi
    while dh - closure_heading < -math.pi: dh += 2 * math.pi
    waypoints.append([waypoints[0][0], waypoints[0][1], waypoints[0][2], round(dh, 6)])

    # Closure gap check
    gap = math.sqrt((waypoints[-1][0] - waypoints[0][0])**2 +
                    (waypoints[-1][1] - waypoints[0][1])**2)
    print(f"  Closure gap: {gap:.1f} m")

    # Safety car probability (based on circuit type)
    sc_prob = 0.25  # default
    street_circuits = ['monaco', 'singapore', 'baku', 'jeddah', 'las_vegas']
    if circuit_key in street_circuits:
        sc_prob = 0.50

    result = {
        "key": circuit_key,
        "name": display_name,
        "country": country,
        "total_laps": total_laps,
        "pit_loss_sec": pit_loss_sec,
        "base_lap_time_sec": round(base_lap_time, 3),
        "safety_car_probability": sc_prob,
        "circuit_length_m": round(total_length, 1),
        "sector_boundaries": sector_boundaries,
        "n_waypoints": n_resample,
        "waypoints": waypoints,  # [x, y, speed_kph, heading_rad]
        "corners": corners,
        "bounds": {
            "x_min": round(float(x_smooth.min()), 1),
            "x_max": round(float(x_smooth.max()), 1),
            "y_min": round(float(y_smooth.min()), 1),
            "y_max": round(float(y_smooth.max()), 1),
        },
        "source": f"FastF1 {season} {gp_name} Race"
    }

    return result


def verify_track(data):
    """Verify track data integrity."""
    wp = data["waypoints"]
    n = len(wp) - 1  # exclude closure point

    # Check closure
    gap = math.sqrt((wp[-1][0] - wp[0][0])**2 + (wp[-1][1] - wp[0][1])**2)

    # Check for self-intersections (sample every 5th segment)
    crossings = 0
    step = 5
    pts = [(w[0], w[1]) for w in wp]
    for i in range(0, n - 1, step):
        for j in range(i + 3*step, n - 1, step):
            x1, y1 = pts[i]; x2, y2 = pts[min(i+step, n)]
            x3, y3 = pts[j]; x4, y4 = pts[min(j+step, n)]
            denom = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4)
            if abs(denom) < 0.001: continue
            t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / denom
            u = -((x1-x2)*(y1-y3) - (y1-y2)*(x1-x3)) / denom
            if 0.01 < t < 0.99 and 0.01 < u < 0.99:
                crossings += 1

    # Max segment length
    max_seg = max(math.sqrt((wp[i+1][0]-wp[i][0])**2 + (wp[i+1][1]-wp[i][1])**2)
                  for i in range(n))

    return {
        "gap": round(gap, 1),
        "crossings": crossings,
        "max_segment_m": round(max_seg, 1),
        "ok": gap < 50 and crossings == 0
    }


def main():
    print("=" * 60)
    print("FastF1 Track Coordinate Extractor")
    print("=" * 60)

    results = {}
    for circuit in CIRCUITS:
        season, gp, key, name, country, laps, pit = circuit
        try:
            data = extract_circuit(season, gp, key, name, country, laps, pit)
            if data is None:
                print(f"  SKIPPED: {name}")
                continue

            # Verify
            v = verify_track(data)
            data["verification"] = v

            status = "✅" if v["ok"] else "⚠️"
            print(f"  Verify: gap={v['gap']}m crossings={v['crossings']} seg={v['max_segment_m']}m {status}")

            # Save individual track file
            output_path = OUTPUT_DIR / f"{key}.json"
            with open(output_path, "w") as f:
                json.dump(data, f, indent=2)
            print(f"  Saved: {output_path}")

            results[key] = {
                "name": name, "country": country,
                "length_m": data["circuit_length_m"],
                "waypoints": len(data["waypoints"]),
                "corners": len(data["corners"]),
                "status": status
            }

        except Exception as e:
            print(f"  EXCEPTION extracting {name}: {e}")
            import traceback
            traceback.print_exc()

    # Save manifest
    manifest_path = OUTPUT_DIR / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n{'='*60}")
    print(f"SUMMARY: {len(results)} circuits extracted")
    print(f"{'='*60}")
    for key, info in results.items():
        print(f"  {key:16} {info['length_m']:6.0f}m  {info['waypoints']:3d}pts  {info['corners']:2d}corners  {info['status']}")
    print(f"\nAll saved to: {OUTPUT_DIR}/")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()


# """
# Extract Real Circuit Coordinates from FastF1 GPS Telemetry
# ===========================================================
# This script downloads actual F1 telemetry data and extracts
# real circuit XY coordinates, corner positions, sector boundaries,
# speed profiles, and elevation data.
# """

# import fastf1
# import numpy as np
# import json
# import math
# from pathlib import Path

# # Enable caching
# CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
# CACHE_DIR.mkdir(exist_ok=True)
# fastf1.Cache.enable_cache(str(CACHE_DIR))

# OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "tracks"
# OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# CIRCUITS = [
#     (2024, "Miami", "miami", "Miami International Autodrome", "USA", 57, 22.0),
# ]


# def extract_circuit(season, gp_name, circuit_key, display_name, country,
#                     total_laps, pit_loss_sec, n_resample=600):

#     print(f"\n{'='*60}")
#     print(f"Extracting: {display_name} ({gp_name} {season})")
#     print(f"{'='*60}")

#     session = fastf1.get_session(season, gp_name, "R")
#     session.load(telemetry=True, weather=False, messages=False)

#     lap = session.laps.pick_fastest()
#     if lap is None:
#         print("ERROR: No valid lap found")
#         return None

#     # ✅ FIX 1 — Reduce high-frequency telemetry noise
#     tel = lap.get_telemetry()

#     x_raw = tel['X'].values.astype(float)
#     y_raw = tel['Y'].values.astype(float)
#     speed_raw = tel['Speed'].values.astype(float)

#     valid = ~(np.isnan(x_raw) | np.isnan(y_raw))
#     x_raw = x_raw[valid]
#     y_raw = y_raw[valid]
#     speed_raw = speed_raw[valid]

#     print(f"  Telemetry points: {len(x_raw)}")

#     # ✅ FIX 2 — Smooth BEFORE computing distance
#     kernel_size = 7
#     kernel = np.ones(kernel_size) / kernel_size

#     x_pad = np.concatenate([x_raw[-kernel_size:], x_raw, x_raw[:kernel_size]])
#     y_pad = np.concatenate([y_raw[-kernel_size:], y_raw, y_raw[:kernel_size]])

#     x_smooth_full = np.convolve(x_pad, kernel, mode='valid')
#     y_smooth_full = np.convolve(y_pad, kernel, mode='valid')

#     x_smooth = x_smooth_full[:len(x_raw)]
#     y_smooth = y_smooth_full[:len(y_raw)]

#     # Compute geometric length from smoothed centerline
#     tel = lap.get_telemetry().add_distance()
#     total_length = tel['Distance'].iloc[-1]
    
#     # Compute geometric cumulative distance from smoothed XY
#     dx = np.diff(x_smooth)
#     dy = np.diff(y_smooth)
#     seg_lengths = np.sqrt(dx**2 + dy**2)
#     cum_dist_geom = np.concatenate([[0], np.cumsum(seg_lengths)])

#     # Normalize geometric distance to official lap length
#     scale_factor = total_length / cum_dist_geom[-1]
#     cum_dist = cum_dist_geom * scale_factor


#     print(f"  Circuit length: {total_length:.1f} m")

#     # Resample uniformly along track
#     target_dists = np.linspace(0, total_length, n_resample, endpoint=False)

#     x_resampled = np.interp(target_dists, cum_dist, x_smooth)
#     y_resampled = np.interp(target_dists, cum_dist, y_smooth)
#     speed_resampled = np.interp(target_dists, cum_dist, speed_raw)

#     # Compute headings
#     headings = []
#     for i in range(n_resample):
#         j = (i + 1) % n_resample
#         headings.append(math.atan2(
#             y_resampled[j] - y_resampled[i],
#             x_resampled[j] - x_resampled[i]
#         ))

#     headings = np.unwrap(np.array(headings))

#     # Curvature
#     curvature = np.abs(np.diff(headings, prepend=headings[-1]))
#     curvature = np.minimum(curvature, 2 * np.pi - curvature)

#     curvature_threshold = np.percentile(curvature, 80)

#     corners = []
#     in_corner = False
#     corner_start = 0

#     for i in range(n_resample):
#         if curvature[i] > curvature_threshold and not in_corner:
#             in_corner = True
#             corner_start = i
#         elif curvature[i] < curvature_threshold * 0.5 and in_corner:
#             in_corner = False
#             mid = (corner_start + i) // 2
#             corners.append({
#                 "index": int(mid),
#                 "fraction": round(mid / n_resample, 4),
#                 "x": round(float(x_resampled[mid]), 1),
#                 "y": round(float(y_resampled[mid]), 1),
#                 "min_speed": round(float(
#                     speed_resampled[corner_start:i].min()
#                 ), 0),
#             })

#     print(f"  Detected {len(corners)} corners")

#     waypoints = []
#     for i in range(n_resample):
#         waypoints.append([
#             round(float(x_resampled[i]), 1),
#             round(float(y_resampled[i]), 1),
#             round(float(speed_resampled[i]), 0),
#             round(float(headings[i]), 6),
#         ])

#     # Closure point
#     waypoints.append([
#         waypoints[0][0],
#         waypoints[0][1],
#         waypoints[0][2],
#         waypoints[0][3]
#     ])

#     result = {
#         "key": circuit_key,
#         "name": display_name,
#         "country": country,
#         "total_laps": total_laps,
#         "pit_loss_sec": pit_loss_sec,
#         "base_lap_time_sec": float(lap['LapTime'].total_seconds()),
#         "circuit_length_m": round(total_length, 1),
#         "n_waypoints": n_resample,
#         "waypoints": waypoints,
#         "corners": corners,
#     }

#     return result


# def main():
#     for circuit in CIRCUITS:
#         data = extract_circuit(*circuit)
#         if data:
#             output_path = OUTPUT_DIR / f"{data['key']}.json"
#             with open(output_path, "w") as f:
#                 json.dump(data, f, indent=2)
#             print(f"Saved: {output_path}")


# if __name__ == "__main__":
#     main()