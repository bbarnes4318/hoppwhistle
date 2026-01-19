import subprocess, time, json, random, os
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
import logging
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- LOGGING SETUP ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/opt/hopwhistle/dialer.log'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# --- CONFIGURATION FROM ENVIRONMENT ---
AGENT_TRANSFER_NUMBER = os.getenv('AGENT_TRANSFER_NUMBER', '+18653969104')
TELNYX_VALID_DID = os.getenv('TELNYX_VALID_DID', '+17868404940')
TELNYX_API_KEY = os.getenv('TELNYX_API_KEY', '')
TELNYX_CONNECTION_ID = os.getenv('TELNYX_CONNECTION_ID', '')
DEEPGRAM_API_KEY = os.getenv('DEEPGRAM_API_KEY', '')
FREESWITCH_HOST = os.getenv('FREESWITCH_HOST', 'freeswitch')
FREESWITCH_ESL_PORT = os.getenv('FREESWITCH_ESL_PORT', '8021')
FREESWITCH_ESL_PASSWORD = os.getenv('FREESWITCH_ESL_PASSWORD', 'ClueCon')
OUTBOUND_SIP_PROXY = os.getenv('OUTBOUND_SIP_PROXY', 'sip.telnyx.com')

# File paths
DID_FILE = os.getenv('DID_FILE', '/opt/hopwhistle/dids.json')
LEAD_FILE = os.getenv('LEAD_FILE', '/opt/hopwhistle/test_lead.txt')
PROGRESS_FILE = os.getenv('PROGRESS_FILE', '/opt/hopwhistle/already_called.log')
PAUSE_FLAG = os.getenv('PAUSE_FLAG', '/opt/hopwhistle/pause.flag')
STATUS_FILE = os.getenv('STATUS_FILE', '/opt/hopwhistle/dialer_status.json')

# --- CONCURRENCY SETTINGS ---
MAX_CONCURRENT_CALLS = int(os.getenv('MAX_CONCURRENT_CALLS', '10'))
CALL_DELAY_MIN = float(os.getenv('CALL_DELAY_MIN', '3.0'))
CALL_DELAY_MAX = float(os.getenv('CALL_DELAY_MAX', '6.0'))
STAGGER_INITIAL_CALLS = os.getenv('STAGGER_INITIAL_CALLS', 'true').lower() == 'true'

# CARRIER CONFIGS
VOXBEAM_PREFIX = os.getenv('VOXBEAM_PREFIX', '0011104')

# Docker container name (for fs_cli commands)
FREESWITCH_CONTAINER = os.getenv('FREESWITCH_CONTAINER', 'docker-freeswitch-1')

# Thread-safe progress tracking
progress_lock = Lock()
active_calls = 0
active_calls_lock = Lock()


def update_status(status: str, active: int = 0, completed: int = 0, remaining: int = 0):
    """Update status file for UI monitoring."""
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump({
                "status": status,
                "active_calls": active,
                "completed": completed,
                "remaining": remaining,
                "timestamp": time.time()
            }, f)
    except Exception as e:
        log.warning(f"Could not update status: {e}")


def mark_complete(customer_num: str):
    """Thread-safe progress marking."""
    with progress_lock:
        with open(PROGRESS_FILE, 'a') as f:
            f.write(f"{customer_num}\n")


def dial_single(customer_num: str, did_pool: dict) -> dict:
    """
    Dial a single customer with failover chain.
    Returns result dict with status.
    """
    global active_calls

    with active_calls_lock:
        active_calls += 1
        current_active = active_calls

    log.info(f"[DIAL] Starting call to {customer_num} (Active: {current_active}/{MAX_CONCURRENT_CALLS})")

    result = {
        "number": customer_num,
        "status": "pending",
        "carrier": None,
        "error": None
    }

    try:
        # 1. Prepare Number Formats
        clean = "".join(filter(str.isdigit, customer_num))

        # Telnyx Format (+1...)
        fmt_telnyx = f"+{clean}" if clean.startswith('1') else f"+1{clean}"

        # Voxbeam/Anveo Format (1...)
        fmt_clean = f"1{clean}" if not clean.startswith('1') else clean

        if os.getenv('FORCE_CALLER_ID'):
            mask = os.getenv('FORCE_CALLER_ID').replace('+', '')
        else:
            mask = random.choice(list(did_pool.keys())).replace('+', '')

        # 2. CONSTRUCT THE FAILOVER CHAIN
        # Syntax: carrier1|carrier2|carrier3
        # Timeouts per leg for quick failover
        leg_a = f"[leg_timeout=6]sofia/internal/{fmt_telnyx}@{OUTBOUND_SIP_PROXY}"
        leg_b = f"[leg_timeout=6]sofia/gateway/voxbeam/{VOXBEAM_PREFIX}{fmt_clean}"
        leg_c = f"[leg_timeout=6]sofia/gateway/anveo/{fmt_clean}"

        # The Pipe '|' creates automatic fallback
        dial_string = f"{leg_a}|{leg_b}|{leg_c}"

        # Global variables apply to ALL legs
        vars = (f"absolute_codec_string=PCMU,transfer_to_num={AGENT_TRANSFER_NUMBER},"
                f"telnyx_auth_id={TELNYX_VALID_DID},fractel_mask_num={mask},"
                f"origination_caller_id_number={TELNYX_VALID_DID},"
                f"effective_caller_id_number={mask},effective_caller_id_name={mask},"
                f"ignore_early_media=true,continue_on_fail=true")

        cmd = f"docker exec {FREESWITCH_CONTAINER} fs_cli -x \"bgapi originate {{{vars}}}{dial_string} &lua(/opt/hopwhistle/handler.lua)\""

        proc_result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)

        if proc_result.returncode != 0:
            result["status"] = "error"
            result["error"] = proc_result.stderr.strip()
            log.error(f"[DIAL] Error for {customer_num}: {result['error']}")
        else:
            result["status"] = "sent"
            result["carrier"] = "telnyx"  # First in chain
            log.info(f"[DIAL] Sent {customer_num}: {proc_result.stdout.strip()}")

    except subprocess.TimeoutExpired:
        result["status"] = "timeout"
        result["error"] = "Command timeout"
        log.error(f"[DIAL] Timeout for {customer_num}")
    except Exception as e:
        result["status"] = "exception"
        result["error"] = str(e)
        log.error(f"[DIAL] Exception for {customer_num}: {e}")
    finally:
        with active_calls_lock:
            active_calls -= 1
        mark_complete(customer_num)

    return result


def start_concurrent_blast():
    """
    Concurrent dialer with staggered starts for spam avoidance.
    Uses ThreadPoolExecutor for parallel dialing with controlled pacing.
    """
    log.info("=" * 60)
    log.info("NOVA-3 CONCURRENT DIALER v2.0")
    log.info(f"Max Concurrent: {MAX_CONCURRENT_CALLS}")
    log.info(f"Call Delay: {CALL_DELAY_MIN}-{CALL_DELAY_MAX}s (randomized)")
    log.info(f"Telnyx Connection ID: {TELNYX_CONNECTION_ID}")
    log.info(f"FreeSWITCH Host: {FREESWITCH_HOST}")
    log.info(f"Outbound Proxy: {OUTBOUND_SIP_PROXY}")
    log.info("Sequence: TELNYX -> VOXBEAM -> ANVEO")
    log.info("=" * 60)

    # Verify required env vars
    if not TELNYX_API_KEY:
        log.warning("TELNYX_API_KEY not set - some features may not work")
    if not DEEPGRAM_API_KEY:
        log.warning("DEEPGRAM_API_KEY not set - TTS/STT features disabled")

    while True:
        if os.path.exists(PAUSE_FLAG):
            log.info("--- PAUSED ---")
            update_status("paused")
            time.sleep(5)
            continue

        # Load configuration
        try:
            with open(DID_FILE, 'r') as f:
                did_pool = json.load(f)
            with open(LEAD_FILE, 'r') as f:
                leads = [l.strip() for l in f if l.strip()]
            done = set()
            if os.path.exists(PROGRESS_FILE):
                with open(PROGRESS_FILE, 'r') as f:
                    done = set(l.strip() for l in f)
        except Exception as e:
            log.error(f"File Error: {e}")
            update_status("error", remaining=0)
            time.sleep(10)
            continue

        remaining = [l for l in leads if l not in done]

        if not remaining:
            log.info("--- CAMPAIGN COMPLETE ---")
            update_status("complete", completed=len(done))
            time.sleep(60)
            continue

        log.info(f"Starting batch: {len(remaining)} leads remaining")
        update_status("running", remaining=len(remaining))

        # Process in concurrent batches
        completed_count = len(done)
        futures = []

        with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_CALLS) as executor:
            for i, customer_num in enumerate(remaining):
                # Check pause flag between submissions
                if os.path.exists(PAUSE_FLAG):
                    log.info("Pause flag detected, stopping new calls")
                    break

                # Stagger start times for spam avoidance
                if i > 0:
                    delay = random.uniform(CALL_DELAY_MIN, CALL_DELAY_MAX)
                    log.debug(f"Stagger delay: {delay:.1f}s before next call")
                    time.sleep(delay)
                elif STAGGER_INITIAL_CALLS and i == 0:
                    # Small initial delay to let system stabilize
                    time.sleep(random.uniform(1.0, 2.0))

                # Submit call to thread pool
                future = executor.submit(dial_single, customer_num, did_pool)
                futures.append(future)

                # Update status
                with active_calls_lock:
                    current_active = active_calls
                update_status("running", active=current_active,
                            completed=completed_count, remaining=len(remaining) - i - 1)

            # Wait for all calls to complete
            for future in as_completed(futures):
                try:
                    result = future.result()
                    if result["status"] == "sent":
                        completed_count += 1
                except Exception as e:
                    log.error(f"Future error: {e}")

        log.info(f"Batch complete. Total completed: {completed_count}")
        update_status("batch_complete", completed=completed_count)

        # Brief pause between batches
        time.sleep(random.uniform(2.0, 4.0))


if __name__ == '__main__':
    start_concurrent_blast()
