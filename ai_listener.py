import os, time, requests, json
from datetime import datetime

# --- CONFIGURATION ---
TELNYX_API_KEY = "a3d817bf20915a5986f5eea2f91630c6115b5d41"
REC_DIR = "/opt/hopwhistle/recordings"

def fetch_recording(call_id):
    """Downloads the MP3 from Telnyx and saves it locally"""
    url = f"https://api.telnyx.com/v2/recordings?filter[call_session_id]={call_id}"
    headers = {"Authorization": f"Bearer {TELNYX_API_KEY}"}
    try:
        resp = requests.get(url, headers=headers, timeout=10).json()
        if 'data' in resp and len(resp['data']) > 0:
            download_url = resp['data'][0]['download_urls']['mp3']
            audio_content = requests.get(download_url, timeout=10).content
            
            if not os.path.exists(REC_DIR):
                os.makedirs(REC_DIR)
                
            file_path = f"{REC_DIR}/{call_id}.mp3"
            with open(file_path, "wb") as f:
                f.write(audio_content)
            print(f"Successfully saved recording: {call_id}")
            return True
    except Exception as e:
        print(f"Error fetching recording {call_id}: {e}")
    return False

print("--- AI LISTENER ENGINE STARTING ---")

while True:
    flag_path = '/opt/hopwhistle/need_check.json'
    
    if os.path.exists(flag_path):
        try:
            with open(flag_path, 'r') as f:
                data = json.load(f)
            
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            # Use .get() to prevent 'KeyError' crashes
            num = data.get('number', 'Unknown')
            status = data.get('status', 'COMPLETED')
            call_id = data.get('call_id', 'N/A')
            did = data.get('did', 'N/A')
            dur = data.get('duration', '0')

            # NEW FORMAT: Time|Customer|Status|CallID|DID|Duration
            log_entry = f"{now}|{num}|{status}|{call_id}|{did}|{dur}\n"
            
            with open('/opt/hopwhistle/call_history.log', 'a') as f:
                f.write(log_entry)
            
            # 3. Cleanup the trigger flag
            os.remove(flag_path)
            
            # 4. Fetch the recording (Telnyx takes a few seconds to process)
            print(f"Call finished. Waiting 5s for Telnyx to process recording {data['call_id']}...")
            time.sleep(5)
            fetch_recording(data['call_id'])
            
        except Exception as e:
            print(f"Processing Error: {e}")
            if os.path.exists(flag_path): os.remove(flag_path)
            
    time.sleep(1)
