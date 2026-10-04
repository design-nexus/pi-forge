#!/bin/sh
# Pi Forge Linux x64 installer. No OMP package or release fallback.
set -eu
repo=design-nexus/pi-forge
install_dir=${PI_FORGE_INSTALL_DIR:-${PI_INSTALL_DIR:-$HOME/.local/bin}}
ref=
mode=binary
while [ $# -gt 0 ]; do
 case "$1" in
 --binary) mode=binary; shift ;;
 --source) mode=source; shift ;;
 --ref|-r) ref=${2:?Missing ref}; shift 2 ;;
 --ref=*) ref=${1#*=}; shift ;;
 *) echo "Unknown option: $1" >&2; exit 1 ;;
 esac
done
if [ "$mode" = source ]; then
 command -v bun >/dev/null || { echo 'Install Bun >=1.3.14, then retry.' >&2; exit 1; }
 source_dir=${PI_FORGE_SOURCE_DIR:-$HOME/.local/share/pi-forge/source}
 [ ! -e "$source_dir" ] || { echo "Source directory already exists: $source_dir. Update it manually." >&2; exit 1; }
 git clone "https://github.com/$repo.git" "$source_dir"
 if [ -n "$ref" ]; then git -C "$source_dir" checkout "$ref"; fi
 cd "$source_dir"
 bun run setup
 exit 0
fi
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo 'Pi Forge binaries currently support Linux x64 glibc. Use a source installation on other platforms.' >&2; exit 1; }
if ldd --version 2>&1 | grep -qi musl; then echo 'Musl binary releases are not available yet. Use a source installation.' >&2; exit 1; fi
if [ -z "$ref" ]; then
 ref=$(curl -fsSL --connect-timeout 10 --max-time 60 "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
fi
printf '%s' "$ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo 'No valid stable Pi Forge release found.' >&2; exit 1; }
mkdir -p "$install_dir"
tmp=$(mktemp -d "$install_dir/.pi-forge-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
base="https://github.com/$repo/releases/download/$ref"
curl -fsSL --connect-timeout 10 --max-time 900 "$base/pi-forge-linux-x64" -o "$tmp/pi-forge-linux-x64"
curl -fsSL --connect-timeout 10 --max-time 60 "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
(cd "$tmp"; grep -E '^[0-9a-f]{64}  pi-forge-linux-x64$' SHA256SUMS > selected.sha256; [ -s selected.sha256 ]; sha256sum -c selected.sha256)
chmod +x "$tmp/pi-forge-linux-x64"
[ "$("$tmp/pi-forge-linux-x64" --version)" = "pi-forge/${ref#v}" ] || { echo 'Downloaded binary version mismatch.' >&2; exit 1; }
"$tmp/pi-forge-linux-x64" --smoke-test
# Replace the directory entry, not a source launcher's symlink target.
mv -f "$tmp/pi-forge-linux-x64" "$install_dir/pi-forge"
echo "Installed Pi Forge ${ref#v}. Run pi-forge to get started."
