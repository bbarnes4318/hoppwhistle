#!/bin/sh
# Hopwhistle FreeSWITCH Recording Smoke Test
# Runs inside the FreeSWITCH docker container to verify file writing,
# dialplan execution, media path capture, and audio generation.

LOG_PREFIX="[recording-smoke-test]"

log() {
  echo "${LOG_PREFIX} $*"
}

log "Step 1: Testing filesystem write access to /recordings"
touch /recordings/write-test.txt
if [ $? -eq 0 ]; then
  log "SUCCESS: Wrote write-test.txt to /recordings"
  rm -f /recordings/write-test.txt
else
  log "ERROR: Failed to write to /recordings"
  exit 1
fi

log "Current /recordings directory contents:"
ls -lah /recordings

log "Step 2: Triggering loopback call to extension 9999 to generate test.wav"
# Delete old test.wav if exists
rm -f /recordings/test.wav

# Run originate command via fs_cli
fs_cli -x "originate loopback/9999 &park"
ORIG_STATUS=$?

if [ $ORIG_STATUS -ne 0 ]; then
  log "ERROR: fs_cli command failed with exit code $ORIG_STATUS"
  exit 1
fi

log "Waiting 8 seconds for the test call and recording to finish..."
sleep 8

log "Step 3: Verifying generated WAV file /recordings/test.wav"
if [ -f "/recordings/test.wav" ]; then
  FILE_SIZE=$(stat -c%s "/recordings/test.wav" 2>/dev/null || stat -f%z "/recordings/test.wav" 2>/dev/null || echo "0")
  log "SUCCESS: Found test.wav (size: $FILE_SIZE bytes)"
  if [ "$FILE_SIZE" -le 100 ]; then
    log "WARNING: test.wav is very small ($FILE_SIZE bytes), it might be header-only!"
  else
    log "SUCCESS: test.wav contains audio data."
  fi
else
  log "ERROR: test.wav was NOT generated. FreeSWITCH did not write the recording file."
  exit 1
fi

exit 0
