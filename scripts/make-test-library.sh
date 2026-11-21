#!/usr/bin/env bash
# Erzeugt eine kleine, fiktive Test-Musikbibliothek für Entwicklung, Tests und Screenshots.
# Benötigt: ffmpeg, ImageMagick (convert)
#
#   bash scripts/make-test-library.sh [Zielordner]
#
# Enthält absichtlich viele Sonderfälle: FLAC mit Ordner-Covern und Backcover mit Rücken,
# MP3 mit eingebetteten Front-/Backcovern, Compilation (M4A/AAC), Doppel-CD in CD1/CD2-Ordnern
# mit Scans-Unterordner, Album ganz ohne Bilder (OGG), WMA (braucht Transcoding),
# ALAC (braucht Transcoding in Chrome/Firefox), Opus, WAV ohne Tags (Ordnername als Fallback)
# und ein flacher Ordner mit Titeln aus zwei Alben.
set -euo pipefail

OUT="${1:-testlib/music}"
SHORT="${SHORT:-6}"   # Länge der meisten Testtitel in Sekunden
LONG="${LONG:-45}"    # Länge einiger Titel, um Spulen zu testen

command -v ffmpeg >/dev/null || { echo "ffmpeg fehlt"; exit 1; }
command -v convert >/dev/null || { echo "ImageMagick (convert) fehlt"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FONT_TITLE="Anton-Regular"
FONT_SUB="Archivo-Black-Regular"
FONT_TEXT="DejaVu-Sans"
convert -list font | grep -q "Font: $FONT_TITLE" || FONT_TITLE="DejaVu-Sans-Bold"
convert -list font | grep -q "Font: $FONT_SUB" || FONT_SUB="DejaVu-Sans-Bold"

SEED=1
# cover <out> <farbe1> <farbe2> <titel> <künstler> [größe]
cover() {
  local out="$1" c1="$2" c2="$3" title="$4" artist="$5" size="${6:-1000}"
  SEED=$((SEED + 7))
  convert -size "${size}x${size}" gradient:"$c1"-"$c2" \
    \( -size "${size}x${size}" -seed "$SEED" plasma:fractal -blur 0x8 -colorspace Gray -auto-level \) \
    -compose soft-light -composite \
    \( -size "${size}x${size}" xc:none -fill 'rgba(255,255,255,0.10)' -draw "circle $((size/2)),$((size*2/5)) $((size/2)),$((size/10))" \) \
    -compose over -composite \
    -font "$FONT_TITLE" -fill white -gravity south -pointsize $((size / 9)) -annotate +0+$((size / 10)) "$title" \
    -font "$FONT_SUB" -fill 'rgba(255,255,255,0.88)' -gravity north -pointsize $((size / 20)) -annotate +0+$((size / 12)) "$artist" \
    -quality 88 "$out"
}

# back <out> <farbe> <titel> <künstler> <mit_ruecken:1|0> <titel...>
back() {
  local out="$1" c="$2" title="$3" artist="$4" spines="$5"
  shift 5
  local list="" i=1
  for t in "$@"; do list+="$(printf '%02d   %s' "$i" "$t")"$'\n'; i=$((i + 1)); done
  if [ "$spines" = "1" ]; then
    local W=1510 H=1180 S=65
    convert -size ${W}x${H} gradient:"$c"-'#101014' \
      -fill 'rgba(0,0,0,0.45)' -draw "rectangle 0,0 $((S - 1)),$H" -draw "rectangle $((W - S)),0 $W,$H" \
      -font "$FONT_TITLE" -fill white -pointsize 70 -gravity northwest -annotate +150+110 "$title" \
      -font "$FONT_SUB" -fill 'rgba(255,255,255,0.8)' -pointsize 34 -annotate +150+205 "$artist" \
      -font "$FONT_TEXT" -fill white -pointsize 34 -interline-spacing 14 -annotate +150+300 "$list" \
      -font "$FONT_TEXT" -fill 'rgba(255,255,255,0.6)' -pointsize 22 -gravity southwest -annotate +150+60 "discbox Testpressung · Alle Rechte frei erfunden" \
      \( -size ${H}x${S} xc:none -font "$FONT_TITLE" -fill white -pointsize 38 -gravity center -annotate +0+0 "${artist^^}  ·  ${title^^}" -rotate 90 \) \
      -gravity northwest -geometry +$((W - S))+0 -composite \
      \( -size ${H}x${S} xc:none -font "$FONT_TITLE" -fill white -pointsize 38 -gravity center -annotate +0+0 "${artist^^}  ·  ${title^^}" -rotate -90 \) \
      -gravity northwest -geometry +0+0 -composite \
      -quality 88 "$out"
  else
    convert -size 1380x1180 gradient:'#f4f1ea'-"$c" \
      -font "$FONT_TITLE" -fill '#16161a' -pointsize 66 -gravity northwest -annotate +110+100 "$title" \
      -font "$FONT_TEXT" -fill '#16161a' -pointsize 32 -interline-spacing 14 -annotate +110+220 "$list" \
      -quality 88 "$out"
  fi
}

# disc <out.png> <farbe1> <farbe2> <titel>
disc() {
  local out="$1" c1="$2" c2="$3" title="$4"
  convert -size 1000x1000 radial-gradient:"$c1"-"$c2" \
    -font "$FONT_TITLE" -fill white -gravity center -pointsize 64 -annotate +0+230 "$title" \
    \( -size 1000x1000 xc:black -fill white -draw "circle 500,500 500,2" -fill black -draw "circle 500,500 500,562" \) \
    -alpha off -compose CopyOpacity -composite "$out"
}

# tone <out> <frequenz> <dauer> [ffmpeg-optionen...]
tone() {
  local out="$1" f="$2" d="$3"
  shift 3
  ffmpeg -hide_banner -loglevel error -y -f lavfi \
    -i "aevalsrc=0.16*sin(2*PI*${f}*t)*(0.65+0.35*sin(2*PI*1.5*t))+0.09*sin(2*PI*${f}*1.25*t)+0.07*sin(2*PI*${f}*1.5*t)+0.03*sin(2*PI*${f}*2*t):s=44100:d=${d}" \
    -af "afade=t=in:d=0.3,afade=t=out:st=$(echo "$d - 0.6" | bc):d=0.6" -ac 2 "$@" "$out"
}

FREQS=(220 247 262 294 330 349 392 440 494 523)
freq() { echo "${FREQS[$(( $1 % ${#FREQS[@]} ))]}"; }

echo "→ Die Lichter – Nachtfahrt (FLAC, cover.jpg, back.jpg mit Rücken, cd.png)"
D="$OUT/Die Lichter/2019 - Nachtfahrt"; mkdir -p "$D"
T=("Auffahrt" "Neonregen" "Tunnelblick" "Raststätte 3 Uhr" "Leuchtspur" "Ankunft")
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$D/$(printf %02d $n) - ${T[$i]}.flac" "$(freq $i)" "$([ $n -le 2 ] && echo "$LONG" || echo "$SHORT")" -c:a flac -sample_fmt s16 \
    -metadata title="${T[$i]}" -metadata artist="Die Lichter" -metadata album_artist="Die Lichter" -metadata album="Nachtfahrt" \
    -metadata date=2019 -metadata track="$n/${#T[@]}" -metadata genre="Synthpop"
done
cover "$D/cover.jpg" '#ff2d75' '#2b0a3d' "NACHTFAHRT" "DIE LICHTER"
back "$D/back.jpg" '#7a1240' "Nachtfahrt" "Die Lichter" 1 "${T[@]}"
disc "$D/cd.png" '#ff7aa8' '#3b0d4f' "NACHTFAHRT"

echo "→ Marlow Bay – Ocean Tapes (MP3, Front + Back eingebettet)"
D="$OUT/Marlow Bay/Ocean Tapes (2004)"; mkdir -p "$D"
T=("Low Tide" "Seagull Static" "Harbour Lights" "Undertow" "Postcards")
cover "$TMP/ot_front.jpg" '#00b4d8' '#03045e' "OCEAN TAPES" "MARLOW BAY" 800
back "$TMP/ot_back.jpg" '#0077b6' "Ocean Tapes" "Marlow Bay" 1 "${T[@]}"
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$TMP/ot_$n.mp3" "$(freq $((i + 3)))" "$SHORT" -c:a libmp3lame -b:a 192k
  ffmpeg -hide_banner -loglevel error -y -i "$TMP/ot_$n.mp3" -i "$TMP/ot_front.jpg" -i "$TMP/ot_back.jpg" \
    -map 0:a -map 1 -map 2 -c copy -id3v2_version 3 \
    -metadata:s:v:0 title="Front" -metadata:s:v:0 comment="Cover (front)" \
    -metadata:s:v:1 title="Back" -metadata:s:v:1 comment="Cover (back)" \
    -metadata title="${T[$i]}" -metadata artist="Marlow Bay" -metadata album_artist="Marlow Bay" -metadata album="Ocean Tapes" \
    -metadata date=2004 -metadata track="$n/${#T[@]}" -metadata genre="Indie" \
    "$D/$(printf %02d $n) ${T[$i]}.mp3"
done

echo "→ Verschiedene – Sommerhits 1999 (M4A/AAC, Compilation, nur folder.jpg)"
D="$OUT/Compilations/Sommerhits 1999"; mkdir -p "$D"
T=("Sonnendeck" "Eis am Stiel" "Freibad" "Gewitterwolke" "Letzter Bus")
A=("Die Badegäste" "Kiosk Royal" "Melli & die Mopeds" "DJ Wolke" "Nachtschwärmer")
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$D/$(printf %02d $n) ${A[$i]} - ${T[$i]}.m4a" "$(freq $((i + 5)))" "$SHORT" -c:a aac -b:a 160k \
    -metadata title="${T[$i]}" -metadata artist="${A[$i]}" -metadata album_artist="Various Artists" -metadata album="Sommerhits 1999" \
    -metadata date=1999 -metadata track="$n/${#T[@]}" -metadata genre="Pop" -metadata compilation=1
done
cover "$D/folder.jpg" '#ffd60a' '#ff7b00' "SOMMERHITS 99" "VERSCHIEDENE INTERPRETEN"

echo "→ Kai Sommer – Doppelleben (MP3, CD1/CD2, Scans/Back.jpg ohne Rücken)"
D="$OUT/Kai Sommer/Doppelleben"; mkdir -p "$D/CD1" "$D/CD2" "$D/Scans"
T1=("Erster Akt" "Zweiter Blick" "Doppelt hält besser" "Pause")
T2=("Zweites Leben" "Spiegelbild" "Zurück" "Vorhang")
for i in "${!T1[@]}"; do n=$((i + 1))
  tone "$D/CD1/$(printf %02d $n) ${T1[$i]}.mp3" "$(freq $i)" "$SHORT" -c:a libmp3lame -b:a 160k -id3v2_version 3 \
    -metadata title="${T1[$i]}" -metadata artist="Kai Sommer" -metadata album="Doppelleben" -metadata date=2011 \
    -metadata track="$n/4" -metadata disc="1/2" -metadata genre="Liedermacher"
  tone "$D/CD2/$(printf %02d $n) ${T2[$i]}.mp3" "$(freq $((i + 4)))" "$SHORT" -c:a libmp3lame -b:a 160k -id3v2_version 3 \
    -metadata title="${T2[$i]}" -metadata artist="Kai Sommer" -metadata album="Doppelleben" -metadata date=2011 \
    -metadata track="$n/4" -metadata disc="2/2" -metadata genre="Liedermacher"
done
cover "$D/cover.jpg" '#8ecae6' '#023047' "DOPPELLEBEN" "KAI SOMMER"
back "$D/Scans/Back.jpg" '#bde0fe' "Doppelleben" "Kai Sommer" 0 "${T1[@]}" "${T2[@]}"
cover "$D/Scans/Booklet 01.jpg" '#219ebc' '#023047' "SEITE 1" "BOOKLET" 700
cover "$D/Scans/Booklet 02.jpg" '#023047' '#219ebc' "SEITE 2" "BOOKLET" 700

echo "→ Fjordlicht – Polarnacht (OGG Vorbis, ohne Bilder)"
D="$OUT/Fjordlicht/Polarnacht"; mkdir -p "$D"
T=("Nordlicht" "Eisnebel" "Lange Dämmerung")
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$D/$n. ${T[$i]}.ogg" "$(freq $((i + 2)))" "$SHORT" -c:a libvorbis -q:a 3 \
    -metadata title="${T[$i]}" -metadata artist="Fjordlicht" -metadata album="Polarnacht" -metadata date=1998 \
    -metadata track="$n" -metadata genre="Ambient"
done

echo "→ Old Archive – Live 2003 (WMA, Windows-Media-Player-Cover)"
D="$OUT/Old Archive/Live 2003"; mkdir -p "$D"
T=("Intro" "Feedback Loop" "Encore")
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$D/$(printf %02d $n) ${T[$i]}.wma" "$(freq $((i + 6)))" "$([ $n -eq 2 ] && echo "$LONG" || echo "$SHORT")" -c:a wmav2 -b:a 128k \
    -metadata title="${T[$i]}" -metadata artist="Old Archive" -metadata album_artist="Old Archive" -metadata album="Live 2003" \
    -metadata date=2003 -metadata track="$n" -metadata genre="Rock"
done
cover "$D/AlbumArt_{7D3E2A10-5B1C-4E0F-9A77-3C5D1E2F4A6B}_Large.jpg" '#e63946' '#1d3557' "LIVE 2003" "OLD ARCHIVE"
cp "$D/AlbumArt_{7D3E2A10-5B1C-4E0F-9A77-3C5D1E2F4A6B}_Large.jpg" "$D/Folder.jpg"

echo "→ Einzeltitel (flacher Ordner mit zwei Alben)"
D="$OUT/Einzeltitel"; mkdir -p "$D"
tone "$D/Nova Kid - Lichtjahr.mp3" 330 "$SHORT" -c:a libmp3lame -b:a 128k -metadata title="Lichtjahr" -metadata artist="Nova Kid" -metadata album="Singles A" -metadata track=1 -metadata date=2020
tone "$D/Nova Kid - Umlaufbahn.mp3" 392 "$SHORT" -c:a libmp3lame -b:a 128k -metadata title="Umlaufbahn" -metadata artist="Nova Kid" -metadata album="Singles A" -metadata track=2 -metadata date=2020
tone "$D/Low Season - Off Peak.mp3" 262 "$SHORT" -c:a libmp3lame -b:a 128k -metadata title="Off Peak" -metadata artist="Low Season" -metadata album="Radio Edits" -metadata track=1 -metadata date=2017
tone "$D/Low Season - Shoulder Months.mp3" 294 "$SHORT" -c:a libmp3lame -b:a 128k -metadata title="Shoulder Months" -metadata artist="Low Season" -metadata album="Radio Edits" -metadata track=2 -metadata date=2017

echo "→ Moonshine Collective – Basement Sessions (WAV ohne Tags, front.png)"
D="$OUT/Moonshine Collective - Basement Sessions"; mkdir -p "$D"
for n in 1 2 3; do tone "$D/Track $n.wav" "$(freq $((n + 1)))" "$SHORT" -c:a pcm_s16le; done
cover "$D/front.png" '#2a9d8f' '#264653' "BASEMENT SESSIONS" "MOONSHINE COLLECTIVE" 900

echo "→ Echo Valley – Glass Rivers (ALAC)"
D="$OUT/Echo Valley/Glass Rivers"; mkdir -p "$D"
T=("Clearwater" "Riverstone" "Thaw" "Delta")
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$D/$(printf %02d $n) ${T[$i]}.m4a" "$(freq $((i + 1)))" "$SHORT" -c:a alac \
    -metadata title="${T[$i]}" -metadata artist="Echo Valley" -metadata album_artist="Echo Valley" -metadata album="Glass Rivers" \
    -metadata date=2016 -metadata track="$n/${#T[@]}" -metadata genre="Folk"
done
cover "$D/cover.png" '#caf0f8' '#0096c7' "GLASS RIVERS" "ECHO VALLEY" 900

echo "→ Paper Planes – Opus Nights (Opus)"
D="$OUT/Paper Planes/Opus Nights"; mkdir -p "$D"
T=("Takeoff" "Cruising Altitude" "Night Flight")
for i in "${!T[@]}"; do n=$((i + 1))
  tone "$D/$(printf %02d $n) ${T[$i]}.opus" "$(freq $((i + 7)))" "$SHORT" -c:a libopus -b:a 96k \
    -metadata title="${T[$i]}" -metadata artist="Paper Planes" -metadata album_artist="Paper Planes" -metadata album="Opus Nights" \
    -metadata date=2021 -metadata track="$n/${#T[@]}" -metadata genre="Electronic"
done
cover "$D/cover.jpg" '#7209b7' '#f72585' "OPUS NIGHTS" "PAPER PLANES"

echo "→ Füll-Alben"
FILL=(
  "Ampelmann|Grüne Welle|2008|Deutschpop|#2dc653|#0b3d20"
  "Bernsteinzimmer|Harz & Honig|2013|Folk|#f9a03f|#5f2c0a"
  "Cassette Kids|Rewind|1987|New Wave|#ff006e|#3a0ca3"
  "Dünenwind|Salzwiesen|2015|Ambient|#a8dadc|#1d3557"
  "Electric Nonna|Spaghetti Western|2010|Surf Rock|#e9c46a|#9c2a1c"
  "Funkstille|Kein Empfang|2002|Post-Rock|#6c757d|#121212"
  "Glühwürmchen|Sommernachtsklub|2018|Disco|#ffbe0b|#8338ec"
  "Hafenkran|Containerblues|1996|Blues|#1982c4|#0b1d3a"
  "Isar Brass|Blech & Blau|2012|Jazz|#ffcf56|#2c1810"
  "Jet Lag Club|Zeitzonen|2022|Electronic|#00f5d4|#3a0ca3"
  "Kaltfront|Barometer|2006|Metal|#adb5bd|#212529"
  "Lavendelfeld|Provence|2019|Chanson|#c8b6ff|#4a306d"
  "Mondfähre|Apollo Nights|1979|Space Rock|#e0e1dd|#0d1b2a"
  "Nordstadt Soul|Zeche|1974|Soul|#ff7b00|#3d1f00"
)
idx=0
for row in "${FILL[@]}"; do
  IFS='|' read -r ART ALB YEAR GEN C1 C2 <<<"$row"
  D="$OUT/$ART/$ALB"; mkdir -p "$D"
  for n in 1 2; do
    tone "$D/0$n - Teil $n.mp3" "$(freq $((idx + n)))" 4 -c:a libmp3lame -b:a 96k -id3v2_version 3 \
      -metadata title="Teil $n" -metadata artist="$ART" -metadata album_artist="$ART" -metadata album="$ALB" \
      -metadata date="$YEAR" -metadata track="$n/2" -metadata genre="$GEN"
  done
  cover "$D/cover.jpg" "$C1" "$C2" "${ALB^^}" "${ART^^}" 700
  if [ $((idx % 3)) -eq 0 ]; then back "$D/back.jpg" "$C2" "$ALB" "$ART" 1 "Teil 1" "Teil 2"; fi
  idx=$((idx + 1))
done

echo "Fertig: $(find "$OUT" -type f | wc -l) Dateien in $OUT"
