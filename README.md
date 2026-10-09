# Lumen — a canvas that thinks with you

An AI-native infinite canvas built on the [Excalidraw](https://github.com/excalidraw/excalidraw) React component (MIT).
You sketch, drop notes, or paste text — and the canvas **understands what you made** and offers the next move *right where the
thing lives*. No chat sidebar. Rough ideas become structure, structure becomes something you can run.

```
npm install
npm run dev          # http://localhost:5173
```

It works **with no API key**. Add one (or deploy with a server key) and Claude takes over for generation, sketch-reading and bespoke apps.

---

## What's different from "whiteboard + chatbot"

| Idea | What it does |
| --- | --- |
| **The dock, not a chat box** | Select anything and a small dock appears *at the selection* with the verbs that make sense for **that** selection: notes → *Cluster*; an outline → *Structure it / Mind map*; a flowchart → *Make it run / Find gaps / Tidy up*; a lone sketch → *Make it real*. Free text is always one `/` away (or ⌘K). |
| **Results are canvas objects** | Answers become sticky notes tethered to their source, critiques become flags pinned next to the offending node, clusters become animated lanes. Everything is selectable, editable and undoable (`Undo` in the toast = the real Excalidraw history, one step per action). |
| **Live objects** | A diagram becomes a **working prototype on the canvas**: a flowchart turns into a walkable simulation (decisions become buttons), a list becomes a progress-tracking checklist, "pomodoro timer" / "poll" / "kanban" / "calculator"… become real tools. Live objects are sandboxed apps (`<iframe sandbox="allow-scripts">`, no same-origin) with a tiny bridge (`lumen.state` / `lumen.save`) so **their state is saved in the document**, synced and versioned like any other element. Select one to edit its code, open it full-screen, duplicate it — or tell Claude to change it. |
| **Deterministic intelligence, offline** | The offline engine isn't a stub: outline/indentation parsing, arrow syntax (`Idea -> Prototype -> Test`), decision/branch detection, topic-aware clustering (TF-IDF + a built-in topic lexicon + spatial proximity), graph linting (dead ends, decisions with one exit, loops with no exit, orphans, duplicates), doc generation, and board scaffolds (kanban, SWOT, retro, pros/cons, journey). |
| **Claude when you want it** | One tool-call contract (`canvas_plan`). Claude receives a *semantic* description of the canvas (items, text, positions, connections) **plus an image of the selection**, so it can read sketches and handwriting and build a bespoke working app from them. |
| **Safe by construction** | Model output is coerced through `sanitizePlan` into well-formed ops (unknown ops, dangling edges, oversize payloads dropped); apps run in an opaque-origin sandbox; the hosted proxy pins the model, caps tokens, whitelists fields and rate-limits. If Claude fails, the offline engine still answers. |
| **Never lose work** | Local-first projects (IndexedDB), autosave, multiple boards, and **version history** — Lumen checkpoints *before every AI action*, plus manual named checkpoints, with per-version diffs (`+3 −1 ~2`) and one-click restore (itself undoable). |
| **Serverless sharing** | *Copy share link* packs the whole board into the URL fragment (gzip + base64url). The fragment never reaches a server; opening it imports the board as a new local project — on any device. |
| **Collab-ready architecture** | A `SyncAdapter` interface. Today's adapter is `BroadcastChannel`: live multi-tab collaboration with presence and cursors, using Excalidraw's `reconcileElements` for conflict-free merges. A WebSocket / Yjs adapter is a drop-in (`src/store/sync.ts`). |

---

## Foundation decision

| Candidate | License | Verdict |
| --- | --- | --- |
| **Excalidraw** (`@excalidraw/excalidraw` 0.18) | **MIT** | ✅ Chosen. Mature drawing engine, hand-drawn aesthetic, embeddables, bound arrows/text, history, collab-grade element reconciliation, touch support. |
| tldraw 5 | custom ("SEE LICENSE") — production use requires a license key | ❌ Not a permissive foundation for an open deployable product. |
| AFFiNE | MIT core + enterprise-licensed pieces; heavyweight monorepo (BlockSuite, Rust/Electron toolchain) | ❌ Wrong shape for "a React component deployable to Vercel". Studied for its docs+canvas+edgeless-mode ideas (documents as first-class canvas objects → Lumen *doc cards*). |
| Mermaid → Excalidraw | MIT | Not needed: Lumen has its own typed diagram op + `dagre` layout (MIT) with correct arrow geometry and bindings. |

Runtime dependencies: `react`, `@excalidraw/excalidraw`, `@dagrejs/dagre`, `idb-keyval`. Everything else is in `src/`.

---

## Architecture

```
src/
  ai/
    schema.ts      Plan/Op contract + sanitizePlan (the only thing engines must produce)
    intents.ts     selection → suggested verbs; prompt → intent classifier
    local.ts       offline engine (outline, arrows, clustering, review, docs, scaffolds, app picker)
    claude.ts      tool schema, system prompt, payload (+ selection image), BYO-key and proxy transport
    engine.ts      routing: Claude → fallback offline
    settings.ts
  canvas/
    context.ts     elements → semantic graph (notes/shapes/edges), outline parsing, graph review
    layout.ts      dagre flow/tree + custom mind-map layout, text measurement
    execute.ts     Plan → elements; animated moves; arrow re-routing; bound-text carrying
    placement.ts   find free space for new content
    palette.ts
  live/
    runtime.ts     sandbox document composer, state bridge, safe Markdown
    templates.ts   flow runner, checklist, todo, counter, timer, calculator, poll, kanban, tip, dice, signup
    LiveObject.tsx renderEmbeddable target + registry that routes iframe saves to elements
  store/
    projects.ts    IndexedDB projects, versions, diffs, autosave
    share.ts       board ⇄ URL-fragment links (gzip + base64url)
    sync.ts        SyncAdapter + BroadcastChannel implementation
  ui/              Dock, panels (history, settings, code editor, project menu, welcome)
  App.tsx          workspace orchestration
api/
  _core.ts         Claude proxy logic (shared by Vercel + dev server)
  ai.ts            Vercel serverless function
e2e/               Playwright suites (drawing, intents, live objects, persistence, collab, mobile, Claude)
```

The key seam is the **Plan**: `{ say, ops[] }` with ops `diagram | notes | board | cluster | app | doc | answer | flag | connect | relayout | restyle | delete`.
Engines produce plans; `execute.ts` turns them into canvas elements (one history entry per plan, animated moves folded in via `CaptureUpdateAction.EVENTUALLY`).

---

## Using Claude

Three ways, in priority order:

1. **Bring your own key** — ✦ in the top-right → paste an Anthropic key. It is stored in `localStorage` only and sent straight to `api.anthropic.com` (browser-direct header).
2. **Hosted** — set `ANTHROPIC_API_KEY` (and optionally `LUMEN_MODEL`) in Vercel; the browser never sees it. The proxy (`api/_core.ts`) pins the model, caps `max_tokens`, forwards only whitelisted fields, limits body size and rate-limits per IP (in-memory, best effort).
3. **Offline** — nothing leaves the device. "Stay offline" in settings enforces it.

```
cp .env.example .env     # ANTHROPIC_API_KEY=sk-ant-…   (works with `npm run dev` and `npm run preview` too)
```

## Deploy to Vercel

```
npx vercel          # framework: Vite, build: npm run build, output: dist (see vercel.json)
```
Set `ANTHROPIC_API_KEY` in the project's environment variables to enable the hosted engine. Excalidraw's fonts are self-hosted (copied to `public/fonts` on install/build) — no third-party CDN is contacted.

---

## Screenshots (captured by the e2e suite)

| | |
| --- | --- |
| ![Clustered](docs/screenshots/02-clustered.png) | ![Find gaps](docs/screenshots/05-find-gaps.png) |
| ![Flow runner](docs/screenshots/06-flow-runner.png) | ![Doc card](docs/screenshots/08-doc-card.png) |
| ![History](docs/screenshots/09-history.png) | ![Mind map](docs/screenshots/15-mindmap.png) |

Phone (390px): ![Mobile](docs/screenshots/13-mobile-clustered.png)

## Tests

```
npm test            # 30 unit tests: planner, clustering, review, layout, placement, markdown, share links, schema sanitising, store, proxy, Claude payload
npm run e2e         # Playwright (builds, serves, drives real Chromium): see e2e/*.spec.ts
```

The e2e suite exercises real pointer drawing, every intent chip, undo, animated clustering, live-object interaction **inside the sandboxed iframe** (state round-trips into the element), sandbox isolation, reload persistence, version restore, multi-project switching, two-tab collaboration, a 390px touch viewport, and the Claude paths with the network mocked at the edge (BYO key payload incl. selection image, hosted proxy, graceful fallback, in-place app editing).

## Known limitations (honest list)

- **Offline engine can't invent knowledge or read freehand sketches.** It restructures, clusters, lints and builds from what's labelled. Generation and sketch-to-app need Claude.
- **Collaboration is same-browser (multi-tab) today.** The architecture is adapter-based but there is no cloud room server yet; there's no auth/sharing.
- Live objects can't make network calls (sandbox + no external resources by design) and keep state as JSON ≤ 400 KB.
- Auto-layout is dagre/mind-map based; very large graphs (>80 nodes) are truncated by `sanitizePlan`.
- Excalidraw's own side panel overlaps the canvas on selection (upstream behaviour); the dock repositions around it but can't move it.
- The hosted proxy's rate limit is per-instance memory (use a durable store for strict limits).
