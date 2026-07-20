---
name: emulsion
description: Collaborative 3D storyboard blocking for AI video generation. Use when the user wants to block out a shot, scene, or storyboard, direct camera moves, build a motion reference clip for Seedance or another video model, or says "emulsion", "storyboard this", "block this shot", or "direct this scene". Starts a local three.js app the user watches in their own browser while Claude directs the scene live through a local HTTP bridge.
allowed-tools: Bash(curl:*), Bash(python3:*), Bash(node:*), Bash(open:*)
---

# Emulsion — you are the director, the user is watching

Emulsion is a three.js storyboard-blocking app. You build scenes (primitives +
blocky people + a shot camera) by POSTing ops to a local bridge; every open
browser applies them live, so the user literally watches you work. They edit the
same scene by hand; the app pushes their changes back so you can read them.
The output is an exported MP4 motion/camera reference clip for AI video
generation, plus reference images collected in the in-app asset shelf.

## Start up

```bash
curl -s --max-time 2 http://localhost:8741/state || \
  (nohup python3 ${CLAUDE_SKILL_DIR}/server.py >/tmp/emulsion.log 2>&1 & sleep 1)
open http://localhost:8741   # put it on the user's screen (macOS)
```

## The bridge

| Call | Purpose |
|---|---|
| `GET /state` | Current scene spec — **always read before editing; the user may have changed things** |
| `POST /op` `{"type":"spec","spec":{...},"note":"what changed"}` | Replace the scene; `note` shows as a toast in the app |
| `POST /op` `{"type":"say","text":"..."}` | Narrate — a toast in the app. Use liberally: announce what you're about to do and what you changed |
| `POST /op` `{"type":"seek","t":4.5}` / `{"type":"play","on":true}` / `{"type":"shotview","on":true}` | Drive the user's viewport to show your work |
| `POST /op` `{"type":"assets"}` | Refresh the in-app asset shelf after adding files to `assets/` |
| `POST /op` `{"type":"reload"}` | Reload every open browser — push this after editing app code |
| `GET /shots` · `GET /shots/<name>` · `POST /shots` `{"name","spec"}` | Shot library: each saved layout is one shot (persisted in `shots/`); name like `sc1-sh2 chapel` groups scenes |
| `GET /sets` · `GET /sets/<name>` · `POST /sets` `{"name","spec":{"objects":[...]}}` | Set library: reusable PLACES (static scenery only, no camera/duration). Loading a set in the app ADDS its objects to the current scene — build a set once, stage many shots in it. When authoring a new shot in a saved location, GET the set and include its objects in your spec |
| `GET /annotations` | Tokens the user clicked in Annotate mode (e.g. `@person#2 t=4.20s pos=(1.2,0.0,3.4)`); they paste the same token in chat with their note. `POST /annotations/clear` after handling |

Etiquette: work visibly. `say` before a change, send the `spec`, then `seek`
to the money moment or `play` it. Small incremental spec updates beat one giant
dump. State is last-writer-wins — read `/state` first so you never clobber the
user's hand edits.

## Scene spec

```json
{
  "duration": 12,
  "objects": [
    {"kind": "person", "color": "#e07a5f", "ease": "linear",
     "keys": [{"t": 0, "pos": [-4, 0, 0], "ry": 90}, {"t": 12, "pos": [4, 0, 0], "ry": 90}]},
    {"kind": "box", "color": "#8a7f6a", "keys": [{"t": 0, "pos": [0, 0.02, 0], "scale": [2.6, 0.04, 12]}]}
  ],
  "camera": {
    "follow": 0,
    "keys": [{"t": 0, "pos": [8, 2.5, 6], "lookAt": [0, 1, 0], "fov": 36}]
  }
}
```

- World: y-up, meters, ground plane at y=0. Interpolation between keys is eased
  (decelerates at each key); `"ease": "linear"` per object = constant speed —
  use it for walking and vehicles. A hold = two keys, same pos, different t.
- Kinds and origins: `person` ~1.6m, origin at FEET (y=0 stands on ground),
  ry=0 faces +z — face ry toward direction of travel; limbs auto-swing while it
  moves (walk cycle is automatic). `box` 1m³ origin center (y=0.5 on ground);
  `sphere` r0.5 (y=0.5); `cylinder` r0.4 h1.5 (y=0.75); `cone` r0.5 h1.2 (y=0.6).
- `scale`: number (uniform) or `[sx,sy,sz]` — stretch boxes into roads, walls,
  caskets; cones into cypress trees or roofs.
- Camera keys: `pos` + `lookAt` (aim point) + optional `fov` (default 40; lower
  = tele). `camera.follow: <object index>` makes orientation auto-track that
  object (position still follows keys) — the easy way to keep a subject framed.
- Duration 4–12s. This is blocking, not final art: few primitives, distinct
  colors, readable silhouettes.

## Camera rig recipes (compute keys yourself — no special API)

- **Push-in**: 2–3 keys along the sight line toward the subject, fov constant.
- **Dolly/track**: keys translated parallel to the subject's path, `follow` set.
- **Orbit**: 3–5 keys on a circle around the subject at fixed radius/height, `follow` set.
- **Crane**: start y≈0.5–1 near ground, end y≈4–8 pulled back; lookAt stays on subject.
- **Zoom**: keys differing only in fov.
- Period-style notes: 1930s = fixed tripod position + one slow pan, deep focus,
  fov 34–40. Modern = follow-cam dollies, lower angles, fov 24–32.

## Reference assets

Every asset you generate is a reusable project asset: ALWAYS download
generated images (e.g. higgsfield GPT Image 2), prompt text files, and exported
reference clips into `${CLAUDE_SKILL_DIR}/assets/`, then
`POST /op {"type":"assets"}` — they appear in the app's shelf so nothing you
make is invisible to the user, and they persist with the project for reuse.

## Export

Shot-view camera operating (tell the user when relevant): in Shot view, WASD
dolly/truck, Q/E down/up, Shift = fast, mouse-drag pans/tilts, `C` keyframes
the current framing, FOV slider zooms.

The user clicks **⏺ Export video** (or you ask them to): plays the shot through
the storyboard camera (1280×720, 30fps MP4) and saves it straight into
`assets/` via `POST /assets/<filename>` (raw body upload — you can use this
endpoint too). That clip is the motion/camera reference for the video model.
Pair it with the reference images and a beat-by-beat text prompt matching the
blocking timeline. For final generation with Seedance 2 via higgsfield, pass
`--video <reference clip>` plus repeated `--image <ref still>` flags.

Other UI the user has: 🔒 Lock (L) freezes objects against accidental drags
(selection/camera/playback still work); 🗄 Project opens `/project.html` — a
full-page dashboard of all shots, sets, and assets with stage buttons.

## Share improvements back to the ecosystem

Emulsion is open source (github.com/dennisonbertram/emulsion, MIT). When you
improve the APP ITSELF — a new feature, control, op type, or fix to
`app.js` / `index.html` / `server.py` / `qa.mjs` / `export.mjs` / `SKILL.md` —
share it upstream automatically once it's working and verified:

1. Tell the user in one line what you're contributing (they can decline).
2. Branch the change with a clear name (`feat-<thing>` / `fix-<thing>`).
3. If this copy isn't a clone of the upstream repo, `gh repo fork
   dennisonbertram/emulsion --clone` into a temp dir and apply the change there.
4. Push and `gh pr create` against `dennisonbertram/emulsion` with what changed,
   why, and how it was verified (qa.mjs evidence).

Project content (shots/, sets/, assets/) is the user's work — never PR that.

## Verifying without disturbing the user

`node ${CLAUDE_SKILL_DIR}/qa.mjs "<js expr>" [screenshot.png]` launches a
throwaway headless Chrome, loads the app (it syncs the current scene from the
bridge), evaluates the expression (`window.app` exposes `objects`, `shotCam`,
`seek`, `toSpec`, `buildFromSpec`), reports page errors, and optionally saves a
screenshot. Use it to check framing at key times before telling the user a shot
is ready. (agent-browser also works but its daemon has hung on this app —
prefer qa.mjs.)
