"""
Undercut / Overcut Analysis
============================
Evaluates pit-stop timing opportunities relative to rival drivers.

- Undercut: pitting 1-2 laps before a rival to gain track position via
  fresh-tyre pace advantage during the rival's in-lap.
- Overcut: staying out while a rival pits, exploiting clear track and
  their cold-tyre warm-up penalty.
"""

from __future__ import annotations

from backend.simulator.config import COMPOUNDS


def _estimate_tyre_delta(
    compound_fresh: str,
    compound_old: str,
    old_age: int,
    compounds: dict = COMPOUNDS,
) -> float:
    """Estimate pace advantage of fresh tyres vs aged tyres per lap."""
    fresh_pace = compounds.get(compound_fresh, {}).get("pace_offset", 0.0)
    old_pace = compounds.get(compound_old, {}).get("pace_offset", 0.0)
    old_deg = compounds.get(compound_old, {}).get("deg", 0.03) * old_age
    return old_deg + (old_pace - fresh_pace)


def analyze_undercut(
    focused_lap_times: list[dict],
    rival_lap_times: list[dict],
    pit_loss: float,
    current_lap: int,
    focused_compound: str = "medium",
    fresh_compound: str = "hard",
    rival_compound: str = "medium",
    rival_tyre_age: int = 10,
    compounds: dict = COMPOUNDS,
) -> dict:
    """
    Evaluate undercut opportunity: pit 1-2 laps before rival.

    The undercut works because fresh tyres provide a significant pace
    advantage on the out-lap, while the rival is still on worn tyres.
    """
    tyre_delta = _estimate_tyre_delta(fresh_compound, rival_compound, rival_tyre_age, compounds)

    # Net gain = tyre advantage over 2-3 laps minus pit loss time
    # A successful undercut gains roughly 2-3 laps of tyre delta minus pit loss
    undercut_laps = 2
    gross_gain = tyre_delta * undercut_laps
    warmup_penalty = 0.8  # fresh tyre warm-up cost (1 lap)
    net_gain = gross_gain - warmup_penalty

    # Consider current gap — undercut only viable if gap is close
    focused_recent = [l for l in focused_lap_times if l.get("lap", 0) >= current_lap - 3]
    rival_recent = [l for l in rival_lap_times if l.get("lap", 0) >= current_lap - 3]

    pace_delta = 0.0
    if focused_recent and rival_recent:
        avg_focused = sum(l["time"] for l in focused_recent) / len(focused_recent)
        avg_rival = sum(l["time"] for l in rival_recent) / len(rival_recent)
        pace_delta = avg_focused - avg_rival  # negative = focused is faster

    viable = net_gain > 0.3 and tyre_delta > 0.5
    confidence = min(1.0, max(0.0, net_gain / 3.0))

    return {
        "type": "undercut",
        "viable": viable,
        "net_gain_seconds": round(net_gain, 3),
        "tyre_delta_per_lap": round(tyre_delta, 3),
        "pace_delta": round(pace_delta, 3),
        "optimal_pit_lap": current_lap + 1,
        "confidence": round(confidence, 3),
    }


def analyze_overcut(
    focused_lap_times: list[dict],
    rival_lap_times: list[dict],
    pit_loss: float,
    current_lap: int,
    focused_compound: str = "medium",
    focused_tyre_age: int = 10,
    compounds: dict = COMPOUNDS,
) -> dict:
    """
    Evaluate overcut opportunity: stay out while rival pits.

    The overcut works when a driver can extend a stint on worn tyres
    while the rival loses time to pit stop + cold tyre warm-up.
    """
    # Estimate rival's warm-up penalty (fresh tyres)
    warmup_penalty = 0.8

    # How much pace do we lose by staying out on worn tyres for 2 more laps?
    deg_rate = compounds.get(focused_compound, {}).get("deg", 0.03)
    extra_deg = deg_rate * 2  # 2 extra laps of degradation

    # Benefit: rival loses warm-up time + we get clear track
    clear_track_benefit = 0.3  # rough estimate of clean air advantage
    net_gain = warmup_penalty + clear_track_benefit - extra_deg

    viable = net_gain > 0.2
    confidence = min(1.0, max(0.0, net_gain / 2.0))

    return {
        "type": "overcut",
        "viable": viable,
        "net_gain_seconds": round(net_gain, 3),
        "extra_degradation": round(extra_deg, 3),
        "confidence": round(confidence, 3),
    }


def scan_all_opportunities(
    focused_lap_times: list[dict],
    all_rival_laps: dict[str, list[dict]],
    pit_loss: float,
    current_lap: int,
    focused_compound: str = "medium",
    focused_tyre_age: int = 10,
    compounds: dict = COMPOUNDS,
) -> list[dict]:
    """
    Scan all nearby rivals for undercut/overcut opportunities.

    Returns a list sorted by net gain (best opportunity first).
    """
    opportunities = []

    for rival, rival_laps in all_rival_laps.items():
        # Analyze undercut
        uc = analyze_undercut(
            focused_lap_times=focused_lap_times,
            rival_lap_times=rival_laps,
            pit_loss=pit_loss,
            current_lap=current_lap,
            focused_compound=focused_compound,
            compounds=compounds,
        )
        uc["rival"] = rival
        opportunities.append(uc)

        # Analyze overcut
        oc = analyze_overcut(
            focused_lap_times=focused_lap_times,
            rival_lap_times=rival_laps,
            pit_loss=pit_loss,
            current_lap=current_lap,
            focused_compound=focused_compound,
            focused_tyre_age=focused_tyre_age,
            compounds=compounds,
        )
        oc["rival"] = rival
        opportunities.append(oc)

    # Sort by net gain descending
    opportunities.sort(key=lambda o: o["net_gain_seconds"], reverse=True)
    return opportunities
