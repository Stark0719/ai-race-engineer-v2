# 🏎️ AI Race Engineer v2

**Telemetry-Driven Probabilistic Strategy Decision System**

A production-grade motorsport intelligence platform combining real F1 telemetry data, physics-informed simulation, Monte Carlo strategy optimization, and AI-powered race engineering — built to demonstrate skills for racing team / gaming team roles.

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React + TypeScript Frontend               │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Track Map │  │ react-three-fiber │  │   Recharts       │  │
│  │ (Canvas)  │  │ 3D Visualization  │  │   Telemetry      │  │
│  └──────────┘  └──────────────────┘  └──────────────────┘  │
│           Zustand State Management + WebSocket               │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────┴──────────────────────────────────┐
│                    FastAPI Python Backend                     │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────────┐ │
│  │ Live Sim  │  │ Monte Carlo   │  │ LLM Tool-Calling     │ │
│  │ Engine    │  │ Strategy      │  │ Agent + RAG          │ │
│  └──────────┘  └───────────────┘  └──────────────────────┘ │
│                    Real Track Data (FastF1 GPS)               │
└──────────────────────────────────────────────────────────────┘
```

## 🔧 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript | Component architecture, type safety |
| **3D Engine** | react-three-fiber + Three.js | Declarative 3D track/car rendering |
| **State** | Zustand | Lightweight reactive state management |
| **Charts** | Recharts | Professional telemetry visualization |
| **Styling** | Tailwind CSS | Utility-first design system |
| **Build** | Vite | Fast HMR, optimized bundling |
| **Backend** | FastAPI (Python) | Async API, WebSocket broadcast |
| **Simulation** | Custom physics engine | Lap time, tyre deg, fuel model |
| **Strategy** | Monte Carlo simulation | 1-stop vs 2-stop probabilistic comparison |
| **AI Agent** | OpenAI GPT-4o-mini | Tool-calling race engineer |
| **RAG** | ChromaDB + sentence-transformers | FIA rules, strategy knowledge |
| **Track Data** | FastF1 GPS telemetry | Real circuit coordinates from F1 sessions |
| **Data** | pandas + pyarrow | Telemetry processing pipeline |

## 🚀 Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- npm or yarn

### 1. Clone & Setup Backend

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r backend/requirements.txt
```

### 2. Extract Real Track Data (requires internet)

```bash
python scripts/extract_tracks.py
```

This downloads real F1 GPS telemetry from the 2024 season and creates
`data/tracks/<circuit>.json` files with actual circuit coordinates.

### 3. Generate Race Data (optional)

```bash
# Included sample parquet files are already checked in under data/.
# Rebuild scripts for stints/features are not yet included in this repo.
```

### 4. Configure API Key

```bash
echo "OPENAI_API_KEY=your-key-here" > .env
```

### 5. Start Backend

```bash
python -m uvicorn backend.api.main:app --reload --port 8000
```

### 6. Setup & Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## 📊 What This Demonstrates

- **Real-time data engineering** — GPS telemetry extraction, processing, visualization
- **Physics-based simulation** — Tyre degradation, fuel load, safety car modeling
- **Probabilistic decision-making** — Monte Carlo strategy comparison with confidence intervals
- **AI orchestration** — LLM tool-calling with RAG knowledge retrieval
- **Full-stack architecture** — React + FastAPI + WebSocket + 3D rendering
- **Production patterns** — TypeScript, Zustand state management, component architecture

## 📂 Project Structure

```
ai-race-engineer-v2/
├── frontend/              React + TypeScript app
│   ├── src/
│   │   ├── components/    UI components
│   │   │   ├── track/     Track map, 3D track surface
│   │   │   ├── car/       3D car model (future: GLTF)
│   │   │   ├── telemetry/ Charts, data panels
│   │   │   ├── strategy/  Monte Carlo controls
│   │   │   └── chat/      AI engineer interface
│   │   ├── stores/        Zustand state management
│   │   ├── hooks/         WebSocket, animation hooks
│   │   └── types/         TypeScript interfaces
│   ├── package.json
│   └── vite.config.ts
├── backend/               FastAPI Python backend
│   ├── api/               REST + WebSocket endpoints
│   ├── simulator/         Physics engine, tracks
│   ├── agent/             LLM orchestration, RAG
│   └── ingestion/         FastF1 data pipeline
├── scripts/               Track extraction, utilities
├── data/
│   └── tracks/            Real circuit GPS data (JSON)
└── knowledge/             FIA rules, strategy docs
```

## 🛣 Roadmap

- [x] Real GPS track coordinates from FastF1
- [x] React + TypeScript + Vite frontend
- [x] react-three-fiber 3D visualization
- [x] Zustand state management
- [x] Recharts telemetry charts
- [ ] GLTF F1 car model
- [ ] Multi-car simulation (AI drivers)
- [ ] Track elevation / banking
- [ ] Weather model
- [ ] Docker deployment
- [ ] Voice radio simulation
