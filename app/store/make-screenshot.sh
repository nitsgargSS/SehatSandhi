#!/usr/bin/env bash
# Make a Play Store screenshot (1080×1920) from a phone screenshot: the top of
# the phone image (status bar, test tools) is cropped off and a caption added.
#
#   bash app/store/make-screenshot.sh <out-name> <phone-screenshot.png> <crop-top-px> "<headline>" "<sub-line>"
#
# crop-top-px is in the source image's own pixels. Needs Google Chrome.
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/screenshots"; mkdir -p "$OUT"
NAME="$1"; SRC="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; CROP="$3"; HEAD="$4"; SUB="${5:-}"
W="$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')"
TOP="$(python3 -c "print(round($CROP*820/$W))")"
TMP="$(mktemp -d)"; ln -s "$SRC" "$TMP/src.png"
cat > "$TMP/p.html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#0f6b4a;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.cap{height:330px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 60px;box-sizing:border-box}
h1{margin:0;color:#fff;font-size:60px;line-height:1.1;font-weight:800;letter-spacing:-.5px}
p{margin:16px 0 0;color:#d7efe3;font-size:33px;font-family:"Kohinoor Devanagari","Helvetica Neue",sans-serif}
.ph{width:820px;height:1540px;margin:0 auto;border-radius:44px;overflow:hidden;background:#FAF6EE;box-shadow:0 18px 60px rgba(0,0,0,.35);position:relative}
.ph img{width:820px;position:absolute;left:0;top:-${TOP}px}
</style></head><body><div class="cap"><h1>${HEAD}</h1><p>${SUB}</p></div><div class="ph"><img src="src.png"></div></body></html>
HTML
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files --window-size=1080,1920 --screenshot="$OUT/$NAME.png" "file://$TMP/p.html" > /dev/null 2>&1
rm -rf "$TMP"; echo "made $OUT/$NAME.png"
