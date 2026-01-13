import sys, re, os
from deepgram import Deepgram

DEEPGRAM_KEY = "a3d817bf20915a5986f5eea2f91630c6115b5d41"

def analyze():
    audio_path = sys.argv[1]
    
    # Debug: Check if file exists
    if not os.path.exists(audio_path):
        with open('/opt/hopwhistle/call_logs.txt', 'a') as log:
            log.write(f"CRITICAL: Audio file {audio_path} not found.\n")
        return "ERROR_NO_FILE"

    try:
        dg = Deepgram(DEEPGRAM_KEY)
        with open(audio_path, 'rb') as audio:
            source = {'buffer': audio, 'mimetype': 'audio/wav'}
            response = dg.transcription.sync_prerecorded(source, {'model': 'nova-3', 'smart_format': True})
        
        transcript = response['results']['channels'][0]['alternatives'][0]['transcript'].lower()
        
        # LOG IT IMMEDIATELY
        with open('/opt/hopwhistle/call_logs.txt', 'a') as log:
            log.write(f"AI HEARD: '{transcript}'\n")

        # MACHINE KILLER
        if any(x in transcript for x in ["voicemail", "message", "mailbox", "at the beep"]):
            return "MACHINE"
        
        # POSITIVE MATCH
        if re.search(r"(yes|yeah|yup|sure|ok|okay|hello|hi|here|who|talk|speak|interested)", transcript):
            return "HUMAN_POSITIVE"
            
        return "NEGATIVE"
    except Exception as e:
        with open('/opt/hopwhistle/call_logs.txt', 'a') as log:
            log.write(f"DEEPGRAM ERROR: {str(e)}\n")
        return "ERROR"

if __name__ == "__main__":
    print(analyze())
