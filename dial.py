import subprocess, time, json, random, os

# --- PRODUCTION CONFIGURATION ---
AGENT_TRANSFER_NUMBER = "+18653969104"
TELNYX_VALID_DID = "+17868404940"
DID_FILE = '/opt/hopwhistle/dids.json'
LEAD_FILE = '/opt/hopwhistle/test_lead.txt'
PROGRESS_FILE = '/opt/hopwhistle/already_called.log'
TELNYX_GATEWAY = "sip.telnyx.com"
PAUSE_FLAG = "/opt/hopwhistle/pause.flag"

def start_blast():
    print("--- NOVA-3 PRODUCTION DIALER STARTING ---")
    
    while True:
        # 1. Check for Pause
        if os.path.exists(PAUSE_FLAG):
            print("--- DIALER PAUSED VIA DASHBOARD ---")
            time.sleep(10)
            continue

        # 2. Load Leads and DIDs
        try:
            with open(DID_FILE, 'r') as f:
                DID_POOL = json.load(f)
            with open(LEAD_FILE, 'r') as f:
                leads = [line.strip() for line in f if line.strip()]
            
            done = []
            if os.path.exists(PROGRESS_FILE):
                with open(PROGRESS_FILE, 'r') as f:
                    done = [line.strip() for line in f]
        except Exception as e:
            print(f"FILE ERROR: {e}")
            time.sleep(10)
            continue

        remaining = [l for l in leads if l not in done]

        if not remaining:
            print("--- CAMPAIGN COMPLETE ---")
            time.sleep(60)
            continue

        # 3. Dialing Loop
        for customer_num in remaining:
            if os.path.exists(PAUSE_FLAG):
                break

            # Pick a random mask from your pool
            mask = random.choice(list(DID_POOL.keys())).replace('+', '')
            
            clean = "".join(filter(str.isdigit, customer_num))
            final_dest = f"+{clean}" if clean.startswith('1') else f"+1{clean}"
            
            print(f"DIALING: {final_dest} (Mask: {mask})")
            
            vars = (f"absolute_codec_string=PCMU,transfer_to_num={AGENT_TRANSFER_NUMBER},"
                    f"telnyx_auth_id={TELNYX_VALID_DID},fractel_mask_num={mask},"
                    f"origination_caller_id_number={TELNYX_VALID_DID},"
                    f"effective_caller_id_number={mask},effective_caller_id_name={mask},ignore_early_media=true")

            # THE FIXED COMMAND (NO CUT-OFF)
            cmd = f"docker exec docker-freeswitch-1 fs_cli -x \"bgapi originate {{{vars}}}sofia/internal/{final_dest}@{TELNYX_GATEWAY} &lua(/opt/hopwhistle/handler.lua)\""

            # Execute and actually SHOW the response
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"DOCKER ERROR: {result.stderr}")
            else:
                print(f"FREESWITCH RESPONSE: {result.stdout.strip()}")

            with open(PROGRESS_FILE, 'a') as f:
                f.write(f"{customer_num}\n")
            
            time.sleep(random.uniform(10, 18))

if __name__ == '__main__':
    start_blast()
