#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
# Emscripten must be on PATH. GLM matches the native CMake version.
glm_dir="${GLM_INCLUDE_DIR:-../.cache/deps/glm-1.0.3}"
if [[ ! -f "$glm_dir/glm/glm.hpp" ]]; then
  if [[ -n "${GLM_INCLUDE_DIR:-}" ]]; then
    echo "GLM_INCLUDE_DIR must contain glm/glm.hpp" >&2; exit 1
  fi
  mkdir -p ../.cache/deps
  archive="../.cache/deps/glm-1.0.3.tar.gz"
  curl --fail --location https://codeload.github.com/g-truc/glm/tar.gz/refs/tags/1.0.3 --output "$archive"
  expected=6775e47231a446fd086d660ecc18bcd076531cfedd912fbd66e576b118607001
  if command -v sha256sum >/dev/null; then actual=$(sha256sum "$archive"); else actual=$(shasum -a 256 "$archive"); fi
  [[ "${actual%% *}" == "$expected" ]] || { echo 'GLM checksum mismatch' >&2; exit 1; }
  tar -xzf "$archive" -C ../.cache/deps
fi
mkdir -p packages/engine-wasm/dist
lua_dir="../.cache/deps/lua-5.1.5"
if [[ ! -f "$lua_dir/src/lua.h" ]]; then
  curl --fail --location https://www.lua.org/ftp/lua-5.1.5.tar.gz --output ../.cache/deps/lua-5.1.5.tar.gz
  actual=$(shasum -a 256 ../.cache/deps/lua-5.1.5.tar.gz)
  [[ "${actual%% *}" == 2640fc56a795f29d28ef15e13c34a47e223960b0240e8cb0a82d9b0738695333 ]] || exit 1
  tar -xzf ../.cache/deps/lua-5.1.5.tar.gz -C ../.cache/deps
fi
mkdir -p packages/engine-wasm/dist/lua
lua_objects=()
for file in "$lua_dir"/src/*.c; do
  name="$(basename "$file" .c)"
  case "$name" in lua|luac|print) continue;; esac
  emcc -O2 -I"$lua_dir/src" -c "$file" -o "packages/engine-wasm/dist/lua/$name.o"
  lua_objects+=("packages/engine-wasm/dist/lua/$name.o")
done
emcc packages/engine-wasm/src/geometry.c -O2 -c -o packages/engine-wasm/dist/geometry.o
em++ "${lua_objects[@]}" -I"$lua_dir/src" ../src/engine/script/lua_vm.cpp ../src/game/parameters.cpp -std=c++20 -I"$glm_dir" packages/engine-wasm/src/runtime.cpp packages/engine-wasm/src/sequences.cpp packages/engine-wasm/src/demo_assets.cpp packages/engine-wasm/src/effects.cpp packages/engine-wasm/src/lamp.cpp packages/engine-wasm/src/baby.cpp packages/engine-wasm/src/ui.cpp ../src/engine/ui/uif.cpp ../src/engine/ui/uia.cpp ../src/engine/ui/uilb.cpp ../src/engine/ui/uigb.cpp ../src/engine/ui/ffnt.cpp ../src/engine/ui/unicode_font.cpp ../src/engine/ui/lang_file.cpp ../src/engine/vfx/vfx_effect.cpp ../src/engine/vfx/vfx_system.cpp ../src/engine/vfx/vfx_lensflare.cpp ../src/engine/vfx/vfx_file.cpp ../src/engine/vfx/vfx_schema.cpp packages/engine-wasm/src/locomotion.cpp ../src/game/player_animation.cpp ../src/engine/anim/gani.cpp ../src/engine/anim/rig.cpp ../src/engine/anim/help_bones.cpp ../src/engine/anim/skeleton.cpp ../src/engine/anim/sim_bones.cpp ../src/engine/anim/sim_physics.cpp ../src/engine/anim/demo_file.cpp ../src/engine/anim/anim_codec.cpp ../src/engine/anim/motion_data.cpp ../src/engine/render/scene_lighting.cpp ../src/engine/assets/geom.cpp ../src/engine/physics/collision_world.cpp ../src/engine/data/fox2.cpp ../src/game/stage_data.cpp packages/engine-wasm/dist/geometry.o packages/engine-wasm/src/crypto.cpp ../src/engine/core/strcode.cpp ../src/engine/core/pathcode.cpp -I../src -O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_decrypt_entry","_decode_fmdl","_release_geometry","_vertex_ptr","_index_ptr","_vertex_count","_index_count"]' \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU8","HEAPF32","HEAPU32"]' -o packages/engine-wasm/dist/geometry.js

bash packages/engine-wasm/scripts/build-audio.sh
