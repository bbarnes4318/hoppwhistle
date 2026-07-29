#!/bin/sh
for file in /recordings/*.wav; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    uuid="${filename%.wav}"
    # Check if the filename is a valid UUID pattern (36 chars)
    if [ ${#uuid} -eq 36 ]; then
      echo "=== Processing failed recording: $uuid ==="
      /usr/share/freeswitch/scripts/upload-recording.sh "$file" "$uuid"
    fi
  fi
done
