from openai import OpenAI
from dotenv import load_dotenv
import json
import re
from typing import Any, Dict

from backend.agent.tools import strategy_tool, racing_line_tool
from backend.agent.rag import retrieve_context


load_dotenv()
client = OpenAI()


def _clamp_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def _clamp_float(value: Any, default: float, lo: float, hi: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def _build_live_summary(live_context: Dict[str, Any] | None) -> str:
    ctx = live_context or {}
    telemetry = ctx.get("telemetry") or {}
    lap_times = ctx.get("lap_times") or []
    summary = {
        "race_running": bool(ctx.get("race_running", False)),
        "track_key": ctx.get("track_key", "bahrain"),
        "track_name": ctx.get("track_name", ""),
        "total_laps": int(ctx.get("total_laps", 57)),
        "pit_loss_time": float(ctx.get("pit_loss_time", 20.0)),
        "safety_car_prob": float(ctx.get("safety_car_prob", 0.2)),
        "speed_multiplier": int(ctx.get("speed_multiplier", 10)),
        "latest_telemetry": {
            "lap_number": telemetry.get("lap_number"),
            "sector": telemetry.get("sector"),
            "speed_kph": telemetry.get("speed_kph"),
            "tyre_compound": telemetry.get("tyre_compound"),
            "tyre_age_laps": telemetry.get("tyre_age_laps"),
            "tyre_wear_pct": telemetry.get("tyre_wear_pct"),
            "safety_car": telemetry.get("safety_car"),
            "in_pit": telemetry.get("in_pit"),
            "last_lap_time": telemetry.get("last_lap_time"),
            "sector_1_time": telemetry.get("sector_1_time"),
            "sector_2_time": telemetry.get("sector_2_time"),
            "sector_3_time": telemetry.get("sector_3_time"),
        },
        "recent_lap_times": lap_times[-5:],
    }
    return json.dumps(summary)


def _needs_strategy_tool(message: str) -> bool:
    text = (message or "").lower()
    keys = (
        "pit", "pitstop", "pit stop", "one-stop", "two-stop", "strategy",
        "safety car", "sc probability", "recommend strategy", "undercut", "overcut",
    )
    return any(k in text for k in keys)


def _needs_racing_line_tool(message: str) -> bool:
    text = (message or "").lower()
    keys = (
        "racing line", "line choice", "apex", "corner line", "late apex",
        "early apex", "aggressive line", "conservative line",
    )
    return any(k in text for k in keys)


def _quick_context_answer(user_message: str, live_context: Dict[str, Any] | None) -> str | None:
    text = (user_message or "").strip().lower()
    ctx = live_context or {}
    telemetry = ctx.get("telemetry") or {}
    lap_times = ctx.get("lap_times") or []
    total_laps = int(ctx.get("total_laps", 57))
    track_name = str(ctx.get("track_name", ctx.get("track_key", "track")) or "track")

    # Fast telemetry/status answers with no LLM call.
    if "race running" in text or text in {"status", "race status"}:
        return (
            f"Race is {'running' if ctx.get('race_running') else 'not running'} on {track_name}. "
            f"Current sim speed is {int(ctx.get('speed_multiplier', 1))}x."
        )

    if "best lap" in text:
        if lap_times:
            best = min(lap_times, key=lambda l: float(l.get("time", 1e9)))
            return f"Best lap so far is L{best.get('lap')} in {float(best.get('time', 0.0)):.3f}s on {best.get('compound', 'unknown')}."
        if telemetry.get("last_lap_time", 0) and float(telemetry.get("last_lap_time", 0)) > 0:
            return f"Latest completed lap is {float(telemetry.get('last_lap_time', 0.0)):.3f}s."
        return "No completed lap time yet."

    if re.search(r"\b(s1|s2|s3|sector)\b", text):
        s1 = telemetry.get("sector_1_time")
        s2 = telemetry.get("sector_2_time")
        s3 = telemetry.get("sector_3_time")
        sector = telemetry.get("sector")
        return (
            f"Sector snapshot: current sector S{sector or '-'}; "
            f"S1={float(s1):.3f}s, S2={float(s2):.3f}s, S3={float(s3):.3f}s."
            if s1 and s2 and s3
            else f"Current sector is S{sector or '-'}; sector times are not fully available yet."
        )

    if "tyre" in text or "tire" in text:
        if telemetry:
            return (
                f"Tyre: {str(telemetry.get('tyre_compound', 'unknown')).upper()}, "
                f"age {int(telemetry.get('tyre_age_laps', 0))} laps, "
                f"wear {float(telemetry.get('tyre_wear_pct', 0.0)) * 100:.1f}%, "
                f"temp {float(telemetry.get('tyre_temp_c', 0.0)):.1f}C."
            )
        return "No live tyre telemetry yet."

    if ("when" in text and "pit" in text) or text in {"pit now", "should we pit"}:
        if not telemetry:
            return "No live telemetry yet. Start race and I can call pit timing from wear, sector state, and lap window."
        lap = int(telemetry.get("lap_number", 1))
        wear = float(telemetry.get("tyre_wear_pct", 0.0))
        sc = bool(telemetry.get("safety_car", False))
        laps_left = max(0, total_laps - lap)
        if wear >= 0.68:
            return f"Pit now: tyre wear is {wear * 100:.1f}% on lap {lap}."
        if sc and wear >= 0.45:
            return f"Pit now is favorable under Safety Car on lap {lap} (wear {wear * 100:.1f}%)."
        target = min(total_laps - 2, max(lap + 2, int(total_laps * 0.58)))
        return (
            f"Stay out for now. Suggested pit window: L{target}–L{min(target + 4, total_laps - 1)} "
            f"(current L{lap}, wear {wear * 100:.1f}%, laps left {laps_left})."
        )

    return None


def chat_with_engineer(user_message, driver_code, base_lap_time, live_context=None):
    ctx = live_context or {}
    default_pit_loss = _clamp_float(ctx.get("pit_loss_time"), 20.0, 0.0, 60.0)
    default_sc_prob = _clamp_float(ctx.get("safety_car_prob"), 0.2, 0.0, 1.0)
    default_iters = _clamp_int(ctx.get("strategy_iterations"), 220, 50, 20000)
    default_track = str(ctx.get("track_key", "bahrain"))
    default_horizon = _clamp_int(ctx.get("line_horizon_laps"), 5, 1, 20)
    default_line_iters = _clamp_int(ctx.get("line_iterations"), 180, 50, 5000)
    quick = _quick_context_answer(user_message, ctx)
    if quick:
        return quick
    use_tools = _needs_strategy_tool(user_message) or _needs_racing_line_tool(user_message)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "strategy_tool",
                "description": "Run race strategy simulation and return recommended strategy with confidence. Use defaults if args are omitted.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pit_loss_time": {"type": "number", "description": f"Optional. Defaults to live/track value ({default_pit_loss})."},
                        "safety_car_prob": {"type": "number", "description": f"Optional. Defaults to live/track value ({default_sc_prob})."},
                        "iterations": {"type": "number", "description": f"Optional. Defaults to {default_iters}."}
                    },
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "racing_line_tool",
                "description": "Evaluate multiple racing line styles and return best line with risk/pace metrics. Use defaults if args are omitted.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "track_key": {"type": "string", "description": f"Optional. Defaults to current track ({default_track})."},
                        "horizon_laps": {"type": "number", "description": f"Optional. Defaults to {default_horizon}."},
                        "iterations": {"type": "number", "description": f"Optional. Defaults to {default_line_iters}."}
                    },
                    "required": []
                }
            }
        }
    ]
    
    context = retrieve_context(user_message, k=2)
    live_summary = _build_live_summary(ctx)
    if context.strip():
        system_prompt = (
            "You are a professional race strategy engineer. "
            "Answer all user questions that are possible from available race data, telemetry, strategy outputs, and knowledge docs. "
            "Do not refuse simple data questions. "
            "Use strategy_tool when a simulation/optimization answer is needed (pit timing, one-stop vs two-stop, what-if strategy). "
            "Use racing_line_tool when line-choice analytics are needed. "
            "If data is not available, clearly state what is missing and provide the best estimate from current context. "
            "Keep answers concise and actionable. "
            "Live race context (JSON):\n"
            f"{live_summary}\n\n"
            "Knowledge context:\n\n"
            f"{context}"
        )
    else:
        system_prompt = (
            "You are a professional race strategy engineer. "
            "Answer all user questions that are possible from available race data and telemetry. "
            "Use strategy_tool for strategy simulations and racing_line_tool for line analytics. "
            "If data is missing, explain what is missing and still give a practical recommendation. "
            "Keep answers concise and actionable. "
            "Live race context (JSON):\n"
            f"{live_summary}"
        )
    req = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
    }
    if use_tools:
        req["tools"] = tools
        req["tool_choice"] = "auto"

    response = client.chat.completions.create(**req)

    message = response.choices[0].message

    if use_tools and message.tool_calls:
        tool_messages = []
        for tool_call in message.tool_calls:
            args = json.loads(tool_call.function.arguments or "{}")

            if tool_call.function.name == "strategy_tool":
                tool_result = strategy_tool(
                    driver_code=driver_code,
                    total_laps=int(ctx.get("total_laps", 57)),
                    base_lap_time=base_lap_time,
                    pit_loss_time=_clamp_float(args.get("pit_loss_time"), default_pit_loss, 0.0, 60.0),
                    safety_car_prob=_clamp_float(args.get("safety_car_prob"), default_sc_prob, 0.0, 1.0),
                    iterations=_clamp_int(args.get("iterations"), default_iters, 50, 20000),
                )
            elif tool_call.function.name == "racing_line_tool":
                tool_result = racing_line_tool(
                    track_key=str(args.get("track_key", ctx.get("track_key", "bahrain"))),
                    horizon_laps=_clamp_int(args.get("horizon_laps"), default_horizon, 1, 20),
                    iterations=_clamp_int(args.get("iterations"), default_line_iters, 50, 5000),
                    telemetry=ctx.get("telemetry", {}),
                )
            else:
                tool_result = {"error": f"Unknown tool: {tool_call.function.name}"}

            tool_messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "name": tool_call.function.name,
                "content": json.dumps(tool_result),
            })

        second_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
                message,
                *tool_messages,
            ]
        )
        return second_response.choices[0].message.content

    return message.content
