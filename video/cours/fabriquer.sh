#!/bin/bash
# Fabrique les vidéos de toutes les leçons d'une formation de la file (formations.json).
# Usage : fabriquer.sh <index_dans_la_file> <dossier_travail> <modeles_kokoro> [NN …]
set -e
D=$(cd "$(dirname "$0")" && pwd); idx=$1; W=$2; M=$3; shift 3
read -r fichier export court < <(python3 -c "import json;c=json.load(open('$D/formations.json'))['file'][$idx];print(c['fichier'],c['export'],c['court'])")
nom=$(python3 -c "import json;print(json.load(open('$D/formations.json'))['file'][$idx]['court'])")
node --experimental-strip-types "$D/plan.mjs" "$D/../../web/lib/formations/$fichier" "$export" "$W" 2>/dev/null
titre=$(python3 -c "import json;print(json.load(open('$W/course.json'))['title'])")
nb=$(python3 -c "import json;print(len(json.load(open('$W/course.json'))['lessons']))")
liste=${*:-$(seq -f %02g 1 $nb)}
for n in $liste; do
  n=$(printf %02d $((10#$n)))
  [ -f "$W/l$n.mp4" ] && [ -f "$W/l$n.youtube.json" ] && { echo "leçon $n déjà prête"; continue; }
  node "$D/diapos.mjs" "$W/lecon-$n.json" "$W/l$n/png" "$nom" >/dev/null
  python3 "$D/voix.py" "$M" "$W/lecon-$n.json" "$W/l$n/wav" >/dev/null
  python3 "$D/montage.py" "$W/lecon-$n.json" "$W/l$n/png" "$W/l$n/wav" "$W/l$n.mp4" "$titre" "$M"
  python3 "$D/meta.py" "$W" $((10#$n)) $idx "$W/l$n.youtube.json"
done
