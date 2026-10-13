#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist ../.cache/deps
books=../.cache/deps/packed_codebooks_aoTuV_603.bin
if [[ ! -f "$books" ]]; then
 curl --fail --location https://raw.githubusercontent.com/hcs64/ww2ogg/master/packed_codebooks_aoTuV_603.bin --output "$books"
fi
hash=$(shasum -a 256 "$books")
[[ "${hash%% *}" == 00a93eab267d281401b1efd54e888a2e183299b9e6c446c48d09f701a89d9d27 ]] || exit 1
{ echo '#include <stddef.h>'; echo 'const unsigned char pt_wwise_codebooks[] = {'; od -An -v -tu1 "$books" | awk '{for(i=1;i<=NF;i++) printf "%s,",$i;print ""}'; echo '}; const size_t pt_wwise_codebooks_size=sizeof(pt_wwise_codebooks);'; } > dist/wwise_codebooks.c
emcc -O2 -c dist/wwise_codebooks.c -o dist/wwise_codebooks.o
em++ -std=c++20 -O2 -I../src -I../.cache/deps/glm-1.0.3 -sUSE_VORBIS=1 \
 src/audio.cpp ../src/engine/audio/{sound_engine,sound_package,wwise_bank,wem,wwise_vorbis,dsp,motion_generator,controller_pcm_capture,subtitles}.cpp ../src/engine/core/strcode.cpp dist/wwise_codebooks.o \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 \
 -sEXPORTED_FUNCTIONS='["_malloc","_free"]' -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU8","HEAPF32"]' -o dist/audio-core.js
