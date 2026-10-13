#!/usr/bin/env bash
# Requires .NET 10 and the LibOrbisPkg source prepared with patch_liborbis_readers.py.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo 'Usage: build_local_extractor.sh <patched-LibOrbisPkg-source> <output-directory>' >&2
  exit 2
fi
repo="$(cd "$(dirname "$0")/../.." && pwd)"
liborbis="$(cd "$1" && pwd)"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
dotnet publish "$repo/installer/MacLocal/MacLocal.csproj" -c Release -r osx-arm64 \
  --self-contained true -p:LibOrbisSource="$liborbis" -p:PublishSingleFile=false -o "$2"
