import streamlit as st
import pandas as pd
import os, time

st.set_page_config(page_title="Hopwhistle Command", layout="wide")

# --- PATHS ---
history_file = '/opt/hopwhistle/call_history.log'
recordings_dir = '/opt/hopwhistle/recordings/'
lead_file = '/opt/hopwhistle/test_lead.txt'

st.title("🛡️ Hopwhistle AI Command Center")

# --- SIDEBAR ---
with st.sidebar:
    st.header("⚙️ Controls")
    if st.button("🔴 STOP DIALER"):
        with open("/opt/hopwhistle/pause.flag", "w") as f: f.write("PAUSED")
        st.error("Dialer Paused")
    if st.button("🟢 START DIALER"):
        if os.path.exists("/opt/hopwhistle/pause.flag"): os.remove("/opt/hopwhistle/pause.flag")
        os.system("pm2 restart dialer")
        st.success("Dialer Resumed")

    st.divider()
    st.header("📤 Lead Manager")
    uploaded_file = st.file_uploader("Upload CSV/TXT", type=['csv', 'txt'])
    if uploaded_file and st.button("Add Leads"):
        new_leads = uploaded_file.read().decode("utf-8").splitlines()
        with open(lead_file, 'a') as f:
            for l in new_leads: f.write(f"{l.strip()}\n")
        st.success(f"Added {len(new_leads)} leads")
        os.system("pm2 restart dialer")

# --- MAIN TABLE ---
if os.path.exists(history_file):
    # This reads your specific log format
    try:
        df = pd.read_csv(history_file, sep="|", names=["Time", "Customer", "Status", "Duration", "CallID", "DID"], on_bad_lines='warn')
        
        # Header Row
        h1, h2, h3, h4, h5 = st.columns([1.5, 2, 1, 1, 3])
        h1.subheader("Time")
        h2.subheader("Customer")
        h3.subheader("Result")
        h4.subheader("Dur.")
        h5.subheader("Recording")
        st.divider()

        for _, row in df.iloc[::-1].iterrows():
            c1, c2, c3, c4, c5 = st.columns([1.5, 2, 1, 1, 3])
            
            # Clean up the %2B and + formatting
            clean_num = str(row['Customer']).replace('%2B', '+')
            
            c1.write(row['Time'])
            c2.write(f"**{clean_num}**")
            c3.write(row['Status'])
            c4.write(f"{row['Duration']}")
            
            # Audio player logic
            rec_path = f"{recordings_dir}{row['CallID']}.mp3"
            if os.path.exists(rec_path):
                c5.audio(rec_path)
            else:
                c5.info("⏳ Syncing...")
            st.divider()
    except Exception as e:
        st.error(f"Data Error: {e}")
else:
    st.info("No call data found yet.")

time.sleep(5)
st.rerun()
