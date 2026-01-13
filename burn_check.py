import requests, json

# --- CONFIG ---
API_KEY = "KEY019BA89122328EE1B34CBE395DC29B19" # <--- MAKE SURE THIS IS CORRECT
# --------------

def check_logs():
    url = "https://api.telnyx.com/v2/calls"
    headers = {"Authorization": f"Token {API_KEY}"}
    params = {"page[size]": 100} # Check last 100 calls

    try:
        res = requests.get(url, headers=headers, params=params)
        data = res.json()
        
        burnt_report = {}
        
        for call in data.get('data', []):
            cause = str(call.get('hangup_source', '')) + " " + str(call.get('hangup_cause', ''))
            caller_id = call.get('from', 'Unknown')
            
            # Look for the specific 'Decline' or 603/608 codes
            if "603" in cause or "608" in cause or "CALL_REJECTED" in cause:
                burnt_report[caller_id] = burnt_report.get(caller_id, 0) + 1

        if not burnt_report:
            print("\n[!] No 603/608 errors found in the last 100 calls via API.")
            print("Check if your API Key has 'Reporting' permissions in Telnyx.")
        else:
            print("\n--- BURNT CALLER ID REPORT (Recent Logs) ---")
            for num, count in burnt_report.items():
                print(f"{num}: {count} Rejections")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_logs()
