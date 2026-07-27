# Weave Design Language (WDL)

Weave is not a chat app and not an IDE. It is an **AI operating environment**:
a runtime that plans, executes, remembers, and produces artifacts — with a UI
that makes that runtime visible without ever shouting.

This document is the product's design manifesto. It governs every screen,
component, and interaction. When a design decision is ambiguous, resolve it
against these principles, top to bottom.

## Principles

1. **Runtime visible, AI invisible.**
   The system shows what it is *doing* (planning, executing, indexing), not
   that it is "smart". No sparkles-as-magic, no anthropomorphic filler.

2. **Borders are exceptional, not default.**
   Separation is achieved with tonal surfaces, not lines. A border must
   justify its existence; almost none do.

3. **Every screen has one focal point.**
   If the eye doesn't know where to land, the screen is wrong. One primary
   object per view; everything else is ambient.

4. **Motion communicates state, never decoration.**
   Pulse = running. Slide = new artifact. Check-pop = completed. If an
   animation carries no state information, delete it.

5. **Information density scales with user intent.**
   Idle surfaces are quiet. As the user engages (typing, executing,
   inspecting), density increases. Never show everything at once.

6. **Goals are primary objects.**
   A user message that starts work is a Goal: it has a plan, an execution,
   artifacts, and a memory trail — rendered as one first-class object.

7. **Conversations are lightweight.**
   Chat is the transport, not the product. Messages stay calm; goals carry
   the weight.

8. **Runtime is ambient.**
   Even when the user does nothing, the system breathes: the planner is
   *watching*, the model reports tok/s, memory reports hit rate. Status is
   a living readout, not a static label.

9. **Artifacts are first-class.**
   Everything the system produces is an addressable object with a surface
   (recent artifacts rail, artifacts view, right panel) — never buried in
   message text.

10. **Knowledge feels persistent.**
    Memory, notes, and artifacts behave like a substrate that outlives any
    conversation. The UI treats them as places, not as history.

## Vocabulary

The sidebar is a **workspace navigator**, not a feature list. Four domains:

- **Workspace** — Conversations, Files
- **Knowledge** — Artifacts, Memory, Notes
- **Runtime** — Monitor, Capabilities, Plugins
- **System** — Profile, Settings

The Runtime view is an **activity monitor**, not a dashboard: processes
(Planner, Inference, Tools, Memory, Server) with live state words —
`executing`, `watching`, `listening` — never decorative "online" badges.

## Tokens (source of truth: `src/styles.css`, `tailwind.config.js`)

### Surfaces — depth instead of borders

| Token        | Dark       | Role                     |
| ------------ | ---------- | ------------------------ |
| `background` | `#111111`  | Base canvas              |
| `surface-1`  | `#151515`  | Raised (panels, columns) |
| `surface-2`  | `#191919`  | Floating (hover, popover)|
| `surface-3`  | `#202020`  | Selected                 |

### Accent — exactly one

`--brand` = `#5B8CFF` (dark). Used **only** for: active, running/executing,
success, focus. If something is not one of those four states, it is not
allowed to be brand-colored.

### Typography

| Role     | Face           | Weight | Usage                          |
| -------- | -------------- | ------ | ------------------------------ |
| Display  | IBM Plex Sans  | 700    | Screen titles, the goal hero   |
| Body     | Inter          | 400/500| UI text, messages              |
| Metadata | Inter          | 500    | Section labels (uppercase)     |
| Mono     | JetBrains Mono | 400/500| Data, status readouts, code    |

### Motion

| Class          | Meaning                    |
| -------------- | -------------------------- |
| `status-pulse` | A process is running       |
| `goal-progress`| Planner scan while running |
| `check-pop`    | A goal/step completed      |
| `artifact-enter`/`slide-in` | New object arrived |

### Forbidden

- Glassmorphism (`backdrop-blur`, translucent panels) — the backend is
  technical; the UI is technical. Solid surfaces only.
- Multi-hue gradients and gradient text. Single-hue **brand tints**
  (`brand/10` fills, brand spine, ambient halo) are allowed — they are the
  accent, not decoration.
- Multi-color accent systems.
- Fabricated metrics — if the backend doesn't report it, the UI doesn't
  show it.

### Elevation

Shadows are off by default. Three sanctioned exceptions: the composer
(`.composer` — glows on focus), hover lift (`.lift`), and the ambient halo
(`.ambient-glow`). Elevation marks the focal point; if everything floats,
nothing does.
