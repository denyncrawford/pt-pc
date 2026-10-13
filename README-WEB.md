# Web development

```sh
bun dev
```

Open the URL printed by Bun if the browser does not open automatically. The wizard
lets you select a PKG, import it once, then open the corridor. An existing library
can be reused. Keep the terminal open; Ctrl+C stops the server.

- `server/`: TypeScript backend, PKG import and HTTP range streaming.
- `web/`: WebGPU client, shared WASM scene/physics core and wizard.
- `.data/`: local game library, excluded from Git.
- `.cache/extractor/`: local self-contained extraction helper, excluded from Git.

This Mac is prepared. On a fresh checkout, supply `PT_EXTRACTOR` or prepare the
helper described in `server/README.txt`. Bun serves HTTP; the bundled extraction
helper still uses .NET. No runtime installation is needed for that helper.

The playable checkpoint starts inside f010 (after the f000 introduction). Walk to
the far corner, turn left along the corridor, descend the stairs and face the exit:
the original gc_p00_010 camera/door stream plays and hands control back in f005.
WASD moves, the mouse looks, R returns to this stage's entrance and Escape releases
input. If pointer lock is unavailable, click Caminar and drag to look.
The wizard and `bun dev` are unchanged. The server is still loopback-only.

This is a first-loop traversal, not a complete reproduction of every event:
full player effects, VFX and full post-processing are pending. Radio, spatial attenuation,
original Spanish subtitles and exit-sequence sounds are implemented. Later loops, saves and the f000 introduction are not implemented.

## Shared core and verification

`web/src/runtime.cpp` compiles upstream FOX2, StageData, GEOM, CollisionWorld and
CharacterController into the same WASM module as the FMDL decoder. Simulation
uses fixed 1/300-second steps, normalized diagonal input and a 50 ms frame cap.
It uses the original start connector and probes the real floor for spawn height.
GEOMs requiring unavailable FMDL vertices for movement are rejected, not silently
accepted with holes. Visual and collision geometry use the same FOX2 matrices.

Run `bun run build:wasm` with Emscripten on PATH to rebuild (tested with 6.0.12).
The build caches checksum-verified GLM 1.0.3 and Lua 5.1.5; `GLM_INCLUDE_DIR` may override it.
Normal `bun dev` uses the built module without invoking a compiler.

`bun run test` covers format parsing, HTTP ranges and native physics in WASM
with synthetic GEOM fixtures. To also run the real hallway integration test:
`PT_TEST_PSARC=/absolute/path/to/chunk1.psarc bun run test`.
It verifies floor support, both walls, the corner, stairs and the closed exit.
The optional test reads bounded slices and never commits the user's game data.
A native desktop build has not been run on this Mac; desktop regression
validation remains required before proposing an upstream merge.

The server still spools uploads to disk and streams PSARC byte ranges. The
client prepares hallway packages and the resident exit sequence; adjacent hallways
reuse decoded textures. Unrelated stages are not loaded. It is not yet selective PKG extraction,
a streaming world loader or a production multi-user container service.

## Original textures

The WASM decoder exports UV0 alongside positions/normals. FMDL material and
submesh tables select the original Base_Tex, NormalMap_Tex and SpecularMap_Tex
paths. PathCode64 is shared with the native core. QAR is read via bounded HTTP
ranges; missing streams fall back to the hallway and resident PFTXS packages
inside the PSARC. No game textures are bundled or uploaded to another service.

FTEX chunk decompression is bounded. BC1/2/3/5 and BGRA/R8 decode to RGBA for
WebGPU portability; Fox DXT5 normals use alpha/green. Base maps use sRGB when
the FTEX flag requests it. Initial mip selection caps base maps at 1024 pixels
and normal/specular at 512, with a 256 MiB texture budget and explicit errors.
Textures and material buffers are destroyed when replacing the scene.

Opaque surfaces, alpha masks and transparent decal layers are separate draws.
This is an initial WebGPU material implementation, not shader parity: original
material lookup tables, detail layers, glass and exact material response,
post-processing and exact alpha dithering are not yet reproduced. See below for
the static direct-light, shadow and reflection implementation. Missing maps are reported in the status.

`PT_TEST_PSARC=/path/chunk1.psarc PT_TEST_QAR=/path/texture.qar bun run test`
also validates every selected original map through the unsigned QAR index. Synthetic
tests cover half-float UVs, compression colors/alpha and bounded FTEX inflation.

## Static lighting, shadows and reflections

The WASM bridge reads original light placements and reuses the native
`scene_lighting.cpp` temperature/deflection/lumen conversion and spotlight solid
angle. FOX2 stores all 212 hallway lights disabled for scripted activation;
the playable checkpoint now runs the actual trapLightControl.lua from the archive.
It activates 28 ID60 lights plus two clock lights for f010 and f005. Two adjacent
stages have separate world-space light instances. The geometry-only integration
fixture retains the explicit 38-light ID10 preview for regression comparisons.
Original positions, colors, intensity, range, cone and specular flags are used.
The current main view uses native EV compensation, diffuse luminance metering,
Kawase bloom and the resident color LUT. Full native visual parity remains unverified.

Lights requesting shadows get six 512-square depth maps each. The playable slice
has five shadow lights per stage, ten across the two adjacent stages. The cache
is refreshed while the original door animates and when visibility changes. Alpha masks are respected and
decals excluded from shadow casting. Hardware comparison filtering softens
edges. Static shadows use about 60 MiB of GPU storage and are rebuilt on scene
load and during the exit sequence.

A six-face 256-square RGBA16F capture renders the actual lit corridor. GPU mip
filtering, specular maps, Fresnel and first-corridor box projection produce
rough local reflections. This is one generated local probe, not the original
reflection atlas; parallax outside its box is
approximate. Capture resources use about 4 MiB. The capture samples a separate
placeholder to avoid reading and writing the same texture. GPU validation
failures abort preparation and release allocated lighting resources.

The developer panel toggles shadows/reflections for comparison. Existing wizard,
range streaming, walking and collisions remain in the same `bun dev` flow.
Area-light clipping, all material lookup tables,
later lighting states, exact mirror material effects, bloom and original tonemapping remain
next steps toward visual parity.


### Original indirect light and bathroom mirror

The WASM scene bridge exports the original ShLightProbe volumes, blend margins,
priority and LPSH references. The playable browser reads the 63 probes enabled by Lua (ID60), including dark probes, from the user's archive. It decodes the nine RGB half-float
SH coefficients, applies the native real-SH basis and blends the oriented volumes
in native priority order. The shader reproduces the original 16x16 Lambert
sphere-map lookup and 13/16 sampling radius; ambient is no longer a constant.
The original half-resolution accumulation/upscale and temporal filtering are not
ported: this evaluates the probes directly at full resolution. Adjacent-stage probe volumes
and SH polynomials are rotated by the original connector transform.

The original Mirror entity resolves its FMDL silver surface. Its world-space
plane drives a reflected camera and a 512x512 HDR render every frame. Geometry
behind the plane is clipped, and mirror surfaces are excluded from that capture
to prevent recursion. The existing shell supplies wall collision. Captures include
the currently loaded architecture, direct lights, shadows and SH ambient; missing
props/characters are still absent. Original height/parallax, dirt-mask composition,
mirror flashlight and temporal effects remain approximate or unimplemented.
The mirror adds about 3 MiB of render targets and one extra scene pass per frame.
Developer controls independently toggle indirect light and the mirror. No original
LPSH, mesh or texture is distributed with the code; bun dev and the wizard are unchanged.

### Original Lua, sequence playback and the first stage transition

`web/src/script_bridge.h` hosts Lua 5.1.5 in WASM with the native LuaVm. It exposes
FOX2 entity references, body enable/visibility, collision-owner changes and a queue
of stage/audio/subtitle commands. It removes OS, file, package and debug globals
and applies an instruction budget. Unsupported APIs fail explicitly. This is a
restricted browser adapter, not the full native ScriptHost or a general Lua sandbox.
The original scripts are read from the user's archive, never copied into the repo.

The checkpoint bootstraps the original entrance light/load callbacks because it
starts after the f000 entrance. Runtime f010/common traps use shared transformed
BoxShape queries and direction checks at 30 Hz, alongside 300 Hz physics. The
original Lua Play listener hides the static exit and disables its collider.

`web/src/sequences.cpp` compiles the native DemoStreamFile, animation codec and
motion-data reader. `first-loop.js` plays the 128-frame gc_p00_010 stream at
60000/1001 frames per second. Camera position/orientation, focal length, door hinge
and player-root tracks come from that stream. Static visibility, dynamic shadow
refresh and end-of-sequence collision restoration are integrated with WebGPU.
All stream events are visited in order; four original sound cues are scheduled
on the native mixer clock. Lens effects such as depth of field remain pending. The player's skeletal stream is decoded; authored mesh visibility gates first-person draws.

The next hallway reuses the same package and textures. Its placement is the native
endConnector × Y180 × inverse(startConnector) transform. A second set of geometry,
light/probe instances and collision owners is prepared before opening the exit.
At the end, the player/camera are expressed in the new stage's coordinates, the
old stage is retired and the original f005 light/door setup runs. A real floor
query guards the handoff. This limited adapter batches stage rename/unload requests
until the camera stream finishes; it does not claim native StageManager timing or
a general-purpose streaming stage loader. Further f005 events are not yet executed.
Both f010 and f005 select ID60; no invented lighting preset switch is inserted.
Exposure, bloom and grading were subsequently replaced by the HDR implementation described below.

32 tests pass with the local PSARC and QAR, including a complete input-driven
f010 → sequence → f005 route, grounded movement after handoff, script-selected
lights, event order and adjacent-stage SH rotation. The same route was completed
through the wizard and browser keyboard controls with no console errors. Native
desktop regression validation is still required before an upstream contribution.

Lua's license is retained in `web/THIRD-PARTY-NOTICES.txt`. The built WASM module
contains code only; no game assets are bundled. To replay the first loop, return
to Biblioteca and open the corridor again; R only resets the current stage position.

## Original radio, spatial audio and subtitles

`web/src/audio.cpp` compiles the native SoundBankSet, SoundEngine and SubtitleTable
into a separate WASM module. An AudioWorklet mixes at 48 kHz using the original
BNK/SBP event graph, PCM/IMA/Vorbis media, buses, effects and distance/panning rules.
The listener follows the camera; the radio uses its original Lua position.
`SoundPostEvent` and `VisibleControlSubtitle` commands now reach this adapter.

The five resident banks are read from the user's PSARC through bounded range
requests, then retained in audio WASM (about 100.6 MiB of bank bytes in this copy;
256 MiB input budget and 512 MiB WASM ceiling). This is not fully incremental
per-sound media streaming. No game audio or subtitle text is bundled in the repo.
The audio build uses Emscripten libogg/libvorbis and checksum-verified ww2ogg
codebooks; their licenses are in THIRD-PARTY-NOTICES.txt.

Press Caminar to enable audio. Escape, switching tabs or returning to Biblioteca
pauses it; Caminar resumes. Spanish SUBP text is preferred, with English fallback.
SAB voice markers trigger the original 15-line radio caption timeline. Original
Windows-1252 text is converted using the same helper as the native subtitle UI.
Captions respect script visibility, playback completion and the paused audio clock.
The four exit sounds are scheduled at original frames 1, 4, 35 and 67; camera and
door animation follow the same AudioContext timeline. Stage handoff clears captions.

Tests validate nonzero PCM, directional stereo, stopping the radio, original
caption lookup/encoding and sample-scheduled sequence cues. The wizard-to-f005
route was also completed in the browser with active audio and no console errors.
General ambient emitters and the full
native subtitle priority/range model remain pending.
This does not yet reproduce every acoustic event or every effect of the game.

### Footsteps, acoustic obstruction and area reverb

Footsteps use the original left/right events and native Material switch mapping.
The scene bridge loads FMDL raw positions with GEOM material triangles, then uses
the native surface-height window to choose wood, tile, concrete, blood or the
original stair surface. No synthetic footstep samples are included.

SoundAreaGroup member boxes, ascending priority, aux bus names and send levels
come from FOX2. The source's own position selects the area, as in GameSound:
player steps switch between passage/lobby and the radio retains its lobby send.
The original Wwise bus DSP produces the reverberation tail. Leaving all volumes
clears the sends. These are area sends, not a replacement Web Audio convolver.

Obstruction queries the current active movement collision world at 20 Hz, with a
150 ms smoothing time, and drives the bank's original obstruction volume/LPF
curves. Opening a door removes that collision owner from the query. This is a
browser approximation: a single ray, no diffraction, acoustic portals or wall
transmission; it leaves the separate occlusion parameter at zero to preserve
wet sound. It is currently applied to the radio, not every possible emitter.

The browser now evaluates the original locomotion clips and rig (see below).
Foot-ground markers trigger steps, including while pushing against a wall, as in
the native Player. Displacement alone no longer triggers sounds. Scripted exit
sounds retain their sequence clock; stage handoff resets the locomotion state.

37 tests pass with local data, including acoustic zone selection, stair/tile PCM,
door obstruction, animation contacts and pause and the real DSP's reverb tail and blocked
radio attenuation. Browser verification covered passage → lobby → stairs → f005,
then walking again; no console errors were recorded. Native desktop regression
and complete player-rendering parity remain outstanding.

### Original player locomotion and foot contacts

The wizard reads ShPlayer_layers.mtar, human_finger.frig and the player FMDL
skeleton from player2_common_motion.fpk / plparts_normal.fpk. The new bounded
LoadPlayerAnimationBytes entry point shares the native loader and PlayerBody,
GANI decoder, HumanFinger rig evaluator and pose blending with the desktop port.
No clips, rig data or character assets are bundled with the code.

The browser adapter follows the native 29.97 Hz locomotion decisions, stand
debounce, directional playback rates and eight-motion-frame pose blend. It selects
original stand, start, four-direction walk and stop clips. RIG_ROOT displacement
replaces constant 2 m/s travel; the existing 300 Hz collision controller remains.
The eye follows the evaluated head position instead of a fixed 1.6 m height.
FOOT_GROUND_L/R events supply both timing and side directly; forward walking's
72-frame cycle contacts at frame 18 (right) and 54 (left). The prior 0.8 m cadence
has been removed. Pause freezes advancement, and reset/stage handoff clear state.

This ports locomotion evaluation, movement, eye position and foot-ground sound.
It now draws the skinned player in WebGPU reflections (see below), but does not
port full foot-plant IK, authored clothing simulation, camera roll, every player input/lock or
FOOT_LEAVE/FOOT_CREAK sounds. Keyboard rates use native default parameters; the
full parameter/script system and native 29.97 Hz collision batching are pending.
The adapter is intentionally narrower than the complete native Player class.

32 tests pass with the local archives. New checks validate authored contacts and
sides, all four directions, changing head pose, stop/reset and contacts at a wall.
The wizard route through f010 to f005 and subsequent walking passed in-browser
without console errors. The native desktop build still needs regression testing.

### Player mesh, hands and mirror rendering

`player-body.js` reads the original plr0_main0_def FMDL and its per-mesh bone
palettes. Local joint indices become skeleton indices; bounded, normalized four
weights per vertex drive a WebGPU compute pass. The native PlayerBody supplies
191 skin matrices, including FRDV help bones and its fallback secondary-bone
simulation. The compute output supplies positions and normals to the existing
material renderer. The local model has 52,323 vertices and 54 original texture
maps, all resolved in the verified library. Player PFTXS is a texture fallback.

The mirror draws the complete default body, including hands, using the same
current pose and original textures, and hides the separate MESH_arm group.
The camera view follows native visibility: ordinary walking hides the own body;
sequence player-mesh functors and VisibleMesh events control first-person groups
and their parents. The first gc_p00_010 stream does not enable these groups, so
arms are not artificially placed over that camera. Skeleton tracks, root transform
and skin matrices for that stream are decoded with native readers; other cutscenes
are not yet enabled or validated. The mirror omits the body during a demo, as
in the native mirror-body path.

Developer tools → Probar espejo places the player in front of the actual bathroom
mirror after checking for floor support. Caminar starts/resumes pose playback;
R returns to the stage entrance. This is an inspection shortcut, not progression.
The screenshot is dark because the f010 bathroom lighting remains unchanged.

37 tests pass with local data, including malformed skin rejection, complete bone
palettes, animated hand displacement and sequence skin/view masks. Browser checks
verified the visible moving mirror body, all 54 textures, and f010 → f005 without
JavaScript/WebGPU errors. GPU buffers and player textures are released on reload.
Player textures have their own 256 MiB allocation ceiling in addition to the
hallway budget; combined resource budgeting remains a hosting/low-end task.

Character shading now ports the native gbuffer.frag hair highlight, incidence and eye
iris/lens/sphere sampling, with piecewise sRGB conversion. Hair uses the mirror
view's native default dominant direction, original tangent/handedness and Shift_Tex.
Tangents are skinned in the compute pass. Non-finite authored tangents use the UV
fallback instead of propagating NaNs. The player alpha mask uses the original 8x8
Bayer references (static, without temporal reconstruction); character shadow masks
use the native 0.5 cutoff. Scene alpha handling remains unchanged.

Character direct lighting uses the native translucency expression and Fresnel/NDF
LUT sampling. LUT1/LUT2 generation is ported from CreateBuiltinResources, including
byte quantization and the 3D lookup. Character environment response uses the native
material-table coefficients and finite-source specular broadening, using the native
SourceRadius(light_size) and adjusted-distance expression from lighting.glsl.

The original 256 × 2 linear material table resolves directly from texture.qar.
The previous missing-stream diagnosis was incorrect: WASM returns PathCode64 as a
signed i64 BigInt; the archive stores unsigned uint64 keys. Qar.read now normalizes
with BigInt.asUintN(64). The stream key is b2c3ea97c280d2bf, offset 164736, 248 bytes;
its FTEX header is at 164992 (80 bytes). No reconstruction from material_params.fmtt
is needed. Invalid material indices fail explicitly instead of being clamped.

Read-only local provenance audit (hashes/metadata only):

    bun web/tools/audit-materials.js /path/texture.qar /path/chunk1.psarc

This checks all 19 character materials, their authored indices and all 55 distinct
referenced texture files (54 renderer bindings; the additional Mask_Tex belongs to
the authored shadow material). Missing-table fallback remains available for an
incomplete library and is labelled in developer tools. It is absent for the audited
library. The package helper also supports `--list <pkg>` and
`--extract-file <pkg> <exact-entry> <new-directory>`; selection writes a fixed
resource.bin plus SHA-256 provenance, never a path taken from the package.

Fidelity is NOT verified. The downloaded official v1.0.3 macOS arm64 renderer
recognized all 12 core packages but its headless comparison failed at Vulkan
initialization (MoltenVK: Metal unavailable in this execution environment). No
native screenshot was produced. A matched camera, pose, light state and exposure
comparison is still required, along with temporal alpha and remaining lighting
parity. Native MirrorLight requires an active handy light and a valid mirror light
area; it must not be simulated with an extra brightness light in the first hallway.
The browser remains a first-loop slice; arrival in f005 is not completion of f005.

Mirror shadows restore a separate depth32float array from the static cache before
drawing the current skinned body, preserving native render-flag caster exclusions
and the material alpha cutoff. A pose/static revision prevents repeated work while
paused; restoring the cache removes old silhouettes and clears the body for demos.
Main-view walking shadows retain the native own-body exclusion. This is not yet
the native MirrorLight implementation. The extra 60 layers at 512px cost 60 MiB;
per-light culling, lower quality tiers and GPU timing remain necessary for weak GPUs.

Remaining render differences: no morph facial animation,
authored cloth physics, full foot planting or hand-held flashlight model yet.
Sequence help-bone/simulation parity and native desktop regression also remain.
No character model, animation or texture bytes are distributed in the repository.


Two-loop implementation (2026-10-13)
------------------------------------
Keep `bun dev` and the existing PKG/library wizard. The browser now supports the
physical f010 → f005 → f020 route. In f005, backtrack after encountering the cockroaches:
this enters the newly enabled bathroom trigger behind the player. Let its sequence
finish, then proceed to the exit. A premature exit leaves the player in f005.

The native decoder supports bounded independent sequence handles. Clock, cockroach
actors and bathroom door use their original FSM tracks and model mappings alongside
the exit sequence. Demo-local fileParams and the native VFX parser resolve the
60 clock ticks and seven bathroom impacts to original Wwise events. These particular
VFX files contain sound nodes, not visual particle graphs. Emitters are isolated
from the radio and retired only after their voice finishes/fades. PhotoPrepare ports
the native seven-asset state change; photograph collection is still out of scope.

The headless route test walks through real collision geometry and triggers. It does
not teleport or invoke stage conditions manually. A separate full WebGPU/AudioWorklet
browser run reached f020. Three headless cycles track decoder ownership, live malloc
bytes and reserved WASM heap separately. Three instrumented GPU/audio reload cycles
and native visual comparison remain pending; the overall fidelity milestone is open.

Actor deformation currently uses native skeleton sampling with CPU skinning feeding
WebGPU vertex buffers. Help-bone/tangent parity is not certified. Two hallway copies
and shared textures are reused; this is not a general all-game StageManager yet.
The expanded scene has 164 texture bindings (275.2 MiB decoded at existing mip limits),
within a 320 MiB upload bound; shadows, mirrors and player resources are additional.

Read-only dependency audit:

    bun web/tools/audit-stage.js /path/chunk1.psarc f005

No original model, texture, script or audio bytes are included in the contribution.


### Revisión de escena completa (13 de octubre)

El wizard carga ahora los 143 modelos estáticos originales, incluyendo los muebles
que faltaban bajo el reloj y la lámpara, marcos e imágenes. La tabla de materiales
se aplica también al entorno y se leen los parámetros de emisión originales.
Los mips del entorno se limitan a 512 px para conservar el límite de 320 MiB.
Biblioteca libera explícitamente GPU/audio antes de abrir otra sesión.

El hito sigue abierto: comparación nativa emparejada y renderer completo pendientes.
La cobertura de colisiones sigue siendo la previamente validada; el GEOM adicional
de la puerta lateral bloquea el paso y necesita comparación nativa. La lista de
objetos pendientes queda en `scene.pendingCollisions`. No se certifica el escenario
completo solo porque los modelos sean visibles. Consultar `server/ROADMAP.txt`.

Actualización de calidad (2026-10-13): resolución y mipmaps originales completos,
compresión BC en GPU compatible, cámara nativa 54.9° y encuadre 16:9.
Subnormales, microrrugosidad y MatParamMap conectados. 55 pruebas pasan.
Las tangentes originales y exposición/LUT/bloom se portaron en la entrega HDR
posterior; la iluminación todavía requiere comparación nativa emparejada.

Actualización HDR (2026-10-13): tangentes FMDL originales con signo, transformación
de puertas/actores/etapa adyacente, canal difuso separado para exposición adaptativa,
compensación EV de ShParameterTables, bloom Kawase y LUT original con Hermite.
59 pruebas pasan y se verificó carga, movimiento, pausa, reinicio y descarga GPU/audio.
24 de 202.423 vértices estáticos requieren reconstrucción de tangente. No se certifica
paridad nativa ni tres recorridos completos. Véase server/ROADMAP.txt.

### Floor reflections and per-light shadows (2026-10-13)

The main view now runs the native non-temporal floor SSR march and blend, using
material normals/roughness and the non-ending REFLECT_MAP settings. Shadow bias,
view bias, strength and cone come from each FOX2 light. Cubemap shadow projections
and the local environment probe still differ from the native renderer.
The synthetic binary radio obstruction ray was removed: original bank distance
curves and auxiliary sends remain. See server/ROADMAP.txt for evidence and limits.

### Web pause menu

Escape or Pausa / Opciones freezes gameplay/sequences and suspends audio. Resume,
volume, subtitles, mouse sensitivity/inversion, render scale and graphics toggles
are connected. Restart reloads the available session after confirmation; it is
not persistent save support. The wizard and `bun dev` remain the entry point.
The original f000 wake-up assets are decoded and inventoried but are not yet
connected to the playable boot flow; see server/ROADMAP.txt before claiming an
original new-game sequence. Native-only options are explicitly unavailable.

### Menú original

Opciones se dibuja desde `UI_sys_option.uif`, su layout UILB, animaciones UIA,
texturas y fuentes FFNT de la biblioteca del usuario. El puente WASM reutiliza
los lectores del port. Configuración web permanece como página complementaria.

En Opciones: arrastra la barra para ajustar el brillo (también con flechas), clic para seleccionar,
verticales para idioma, X/Y para invertir cámara, Z o botón derecho para el
zoom de calibración, Enter para Configuración web y Esc para regresar.
Los sonidos de selección se obtienen de `sys_resident.sbp` con el mixer nativo.
Con la búsqueda de fragmentos activa, ampliar la calibración y soltar Z o el
botón derecho recoge PhotoOption al terminar el zoom. Su estado y FrameOption
se conservan entre vueltas durante la sesión. La recogida del resto de piezas,
el efecto subliminal y el sonido de recogida siguen pendientes.
