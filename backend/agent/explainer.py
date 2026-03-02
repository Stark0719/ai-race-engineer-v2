from dotenv import load_dotenv
from openai import OpenAI
import os

load_dotenv()

client = OpenAI()


def explain_strategy(decision, driver_code):
    prompt = f"""
You are a professional Formula race strategy engineer.

Driver: {driver_code}

Simulation Results:
- Recommended strategy: {decision['recommended']}
- Confidence: {decision['confidence']*100:.1f}%
- 1-stop win rate: {decision['one_stop_win_rate']*100:.1f}%
- 2-stop win rate: {decision['two_stop_win_rate']*100:.1f}%
- Pit loss assumed: {decision['pit_loss']} seconds
- Safety car probability: {decision['safety_car_probability']*100:.0f}%

Explain the strategy decision clearly and concisely.
Include:
- Why the recommended strategy is preferred
- Under what conditions it could fail
- Risk assessment
- Tone like a real pit wall engineer
Keep it under 200 words.
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a professional motorsport race engineer."},
            {"role": "user", "content": prompt}
        ]
    )

    return response.choices[0].message.content
