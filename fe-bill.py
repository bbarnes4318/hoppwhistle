# -*- coding: utf-8 -*-
"""
Faster-Whisper ACA call analyzer
- Downloads audio from URLs listed in urls3.txt
- (Optionally) compresses large files via ffmpeg
- Transcribes with faster-whisper (CPU, int8)
- Analyzes transcript via DeepSeek Chat API
- Saves consolidated transcripts, analyses, and a summary
"""

import os
import sys
import logging
import requests
import datetime
import re
import hashlib
import gc
import subprocess
from faster_whisper import WhisperModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

# Optional import for relative date calculations. Used in application submission prompt.
try:
    from dateutil.relativedelta import relativedelta
    dateutil_available = True
except ImportError:
    dateutil_available = False

# -----------------------------------------------------------------------------
# Environment & Logging
# -----------------------------------------------------------------------------
load_dotenv()

LOG_FILE = "transcription_log.log"
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

file_handler = logging.FileHandler(LOG_FILE, encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)

console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.INFO)

logger = logging.getLogger("TranscriptionApp")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    logger.propagate = False

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
AUDIO_FOLDER = "audio_files"
ANALYSIS_FOLDER = "analysis_results"
TRANSCRIPTS_FOLDER = "transcripts"

os.makedirs(AUDIO_FOLDER, exist_ok=True)
os.makedirs(ANALYSIS_FOLDER, exist_ok=True)
os.makedirs(TRANSCRIPTS_FOLDER, exist_ok=True)

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY_2")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_ENDPOINT = os.getenv("DEEPSEEK_ENDPOINT", "https://api.deepseek.com/v1/chat/completions")

WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")  # base/small/medium/large-v2 etc.
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")   # int8/int8_float16/float16

DOWNLOAD_TIMEOUT = int(os.getenv("DOWNLOAD_TIMEOUT", "60"))
ANALYSIS_TIMEOUT = int(os.getenv("ANALYSIS_TIMEOUT", "90"))
MAX_FFMPEG_SECONDS = int(os.getenv("FFMPEG_TIMEOUT", "120"))
LARGE_FILE_THRESHOLD_MB = int(os.getenv("LARGE_FILE_THRESHOLD_MB", "20"))

# -----------------------------------------------------------------------------
# Model Init
# -----------------------------------------------------------------------------
logger.info("Loading Faster-Whisper model...")
try:
    model = WhisperModel(WHISPER_MODEL_NAME, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    logger.info("✓ Faster-Whisper model loaded")
except Exception as e:
    logger.error(f"Failed to load Faster-Whisper: {e}")
    sys.exit(1)

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def read_urls_from_file(file_name: str = "urls3.txt") -> List[str]:
    """Read non-empty, non-comment lines from a text file as URLs."""
    if not os.path.exists(file_name):
        logger.error(f"URL file not found: {file_name}")
        return []
    try:
        with open(file_name, "r", encoding="utf-8") as f:
            urls = []
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                if s.startswith(("http://", "https://")):
                    urls.append(s)
                else:
                    logger.warning(f"Skipping non-HTTP line: {s}")
        logger.info(f"Loaded {len(urls)} URLs from {file_name}")
        return urls
    except Exception as e:
        logger.error(f"Error reading URLs: {e}")
        return []

def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=False)
        return True
    except Exception:
        return False

def download_audio_fast(url: str, output_folder: str) -> Optional[str]:
    """Download audio to MP3; compress if size > threshold (MB)."""
    try:
        url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:16]
        audio_file = os.path.join(output_folder, f"audio_{url_hash}.mp3")

        logger.info(f"Downloading: {url}")
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        with requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT, headers=headers) as r:
            r.raise_for_status()
            with open(audio_file, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

        file_size = os.path.getsize(audio_file)
        if file_size > LARGE_FILE_THRESHOLD_MB * 1024 * 1024 and _ffmpeg_available():
            mb = file_size / (1024 * 1024)
            logger.info(f"Compressing large file ({mb:.1f} MB) with ffmpeg...")
            compressed = os.path.join(output_folder, f"compressed_{url_hash}.mp3")
            cmd = [
                "ffmpeg", "-y",
                "-i", audio_file,
                "-acodec", "mp3",
                "-ab", "32k",
                "-ar", "16000",
                "-ac", "1",
                compressed
            ]
            try:
                subprocess.run(cmd, capture_output=True, check=True, timeout=MAX_FFMPEG_SECONDS)
                os.remove(audio_file)
                return compressed
            except subprocess.CalledProcessError as e:
                logger.warning(f"ffmpeg failed, using original file. Err: {e}")
            except subprocess.TimeoutExpired:
                logger.warning("ffmpeg timed out, using original file.")
        return audio_file

    except Exception as e:
        logger.error(f"Download failed for {url}: {e}")
        return None

def transcribe_audio_fast(audio_file: str) -> str:
    """Transcribe with faster-whisper."""
    if not audio_file or not os.path.exists(audio_file):
        return ""
    try:
        logger.info(f"Transcribing: {os.path.basename(audio_file)}")
        segments, info = model.transcribe(audio_file, beam_size=1, language="en")
        transcript = " ".join(seg.text.strip() for seg in segments if seg.text)
        logger.info(f"Transcription complete: {len(transcript)} chars")
        return transcript
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return ""

def analyze_single_transcript(transcript: str, url_identifier: str) -> str:
    """Analyze transcript and determine whether a final expense application was submitted.

    This function mirrors the prompt and response handling used in the original
    application submission script. It asks the DeepSeek API to evaluate whether
    an application was submitted and to extract supporting details such as
    monthly premium, carrier, customer name, phone number, and agent name.
    Only the structured output specified in the prompt should be returned.
    """
    if not transcript:
        return "Analysis skipped: Empty transcript"
    if not DEEPSEEK_API_KEY:
        return "Analysis failed: No API key"

    logger.info(f"Analyzing transcript for: {url_identifier[:60]}...")

    # Calculate an 81-year cutoff date (retained for completeness, although not
    # directly referenced in the prompt). Fallback to simple subtraction if
    # dateutil is unavailable.
    today = datetime.date.today()
    if dateutil_available:
        cutoff_date = today - relativedelta(years=81)
        cutoff_date_str = cutoff_date.strftime("%B %d, %Y")
    else:
        cutoff_year = today.year - 81
        cutoff_date_str = f"{today.strftime('%B %d')}, {cutoff_year}"

    # Construct the prompt exactly as in the original application analyzer.
    prompt_content = f"""
Analyze the following call transcript:
--- TRANSCRIPT START ---
{transcript}
--- TRANSCRIPT END ---

Your Objectives:
1. Answered Call

	a. Did an insurance agent answer the incoming live transfer phone call? 
	b. If Yes, was a prospect on the call to speak with the insurance agent?

2. Billable Call Determination:
Assess whether the call is billable based SOLELY on the following criteria. Do NOT consider sales outcomes.
Criteria for a Non-Billable Call (Must meet one or more):
    1. Unqualified Customer:
        - Age 81+ (Born on or before {cutoff_date_str}).
        - Lives in nursing home/assisted living.
        - No active bank account/credit card.
        - Needs Power of Attorney for financial decisions.
    2. Vulgar or Prank Call:
        - Clearly wasting agent's time (irrelevant/disruptive).
        - Uses vulgar language.
    3. Do Not Call (DNC) Request:
        - Explicitly requests DNC list placement.
        - Calls only to complain about receiving calls.

Output for Billability:
- Billable: [Yes/No]
- Reason (if Not Billable): [State the specific criterion met, e.g., "Unqualified Customer: Age 81+"]

3. Sale or Application Submitted Determination:
Analyze if a final expense application was submitted, based on these definitions. This is SEPARATE from billability.

Criteria for Final Expense Application Submitted (Must meet ALL applicable points):
    - Requires collection of:
        - Portion of SSN (last 4, first 5, or full 9).
        - Checking/Savings account (Routing & Account #) OR Credit Card Number.
 
Output for Application Submission:
- Application Submitted: [Yes/No]
- Reason (if No): [Explain why, referencing the criteria, e.g., "No payment info collected", "No confirmation of submission mentioned"]

4. Supporting Information (Extract if available, state "Not Provided" otherwise):
    - Customer Name: [Full Name or "Not Provided"]
    - Phone Number: [Number or "Not Provided"]
    - Monthly Premium: [Amount or "Not Provided"]
    - Carrier: [Name or "Not Provided"]
    - Address: [address or "Not Provided"]
    - SSN: [SSN or "Not Provided"]
    - Bank Account Number: [Bank Account Number or "Not Provided"]
    - Bank Routing Number: [Bank Routing Number or "Not Provided"]
    - Card Number, Exp Date, & 3 digit Code: [Card Number, Exp Date, & 3 Digit Code or "Not Provided"]
    - Agent Name: [First Name or "Not Provided"]

--- IMPORTANT INSTRUCTIONS ---
Provide ONLY the structured output based on the format defined above.
Do NOT include any introductory sentences, concluding remarks, summaries (like "### Summary:"), markdown formatting (like '###' or '```'), or any text other than the requested fields and their values.
Ensure every field listed under 'Output for Application Submission' and 'Supporting Information' is present in your response, even if the value is 'No' or 'Not Provided'.
""".strip()

    try:
        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }
        messages = [
            {
                "role": "system",
                "content": "You are an AI assistant analyzing call transcripts. Provide ONLY the requested structured data."
            },
            {"role": "user", "content": prompt_content}
        ]
        data = {
            "messages": messages,
            # Use the configured model if provided, otherwise default to deepseek-chat
            "model": DEEPSEEK_MODEL or "deepseek-chat",
            "max_tokens": 1024,
            "temperature": 0.1,
            "stream": False
        }
        resp = requests.post(
            DEEPSEEK_ENDPOINT,
            headers=headers,
            json=data,
            timeout=ANALYSIS_TIMEOUT
        )
        resp.raise_for_status()
        result = resp.json()
        if "choices" in result and result["choices"]:
            return result["choices"][0]["message"]["content"].strip()
        return "Analysis failed: No response"
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        return f"Analysis failed: {str(e)}"

def extract_application_status(analysis_text: str) -> bool:
    """Determine whether the analysis indicates an application was submitted.

    Searches the analysis text for 'Application Submitted: Yes' or 'Application Submitted: No'
    (case-insensitive). Returns True for 'Yes' and False otherwise.
    """
    try:
        match = re.search(r'Application Submitted:\s*(Yes|No)', analysis_text, re.IGNORECASE)
        if match:
            return match.group(1).lower() == "yes"
        return False
    except Exception:
        return False


# -----------------------------------------------------------------------------
# PARALLEL PROCESSING
# -----------------------------------------------------------------------------
def process_single_url(url_and_num):
    """Process a single URL end-to-end (download → transcribe → analyze).

    This is used by multiple worker threads so calls run in parallel.
    """
    url, i = url_and_num
    logger.info(f"[{i}] Starting: {url[:120]}")

    result: Dict[str, Any] = {
        "url": url,
        "call_number": i,
        "status": "Processing",
        "transcript": "",
        "analysis": "",
        "application_submitted": False
    }

    # Download
    audio_file = download_audio_fast(url, AUDIO_FOLDER)
    if not audio_file:
        result["status"] = "Download Failed"
        result["analysis"] = "Analysis skipped: Download Failed"
        return result

    # Transcribe
    transcript = transcribe_audio_fast(audio_file)
    result["transcript"] = transcript

    # Cleanup audio
    try:
        os.remove(audio_file)
        logger.info(f"[{i}] Cleaned up audio file")
    except Exception:
        pass

    if not transcript:
        result["status"] = "Transcription Failed"
        result["analysis"] = "Analysis skipped: No Transcript"
        return result

    # Analyze
    analysis = analyze_single_transcript(transcript, url)
    result["analysis"] = analysis
    result["application_submitted"] = extract_application_status(analysis)
    result["status"] = "Success"

    gc.collect()
    logger.info(f"✓ Completed call {i}")
    return result

def process_all_urls(urls: List[str]) -> List[Dict[str, Any]]:
    """FAST multithreaded version. Whisper stays loaded ONCE."""
    all_results = []

    if not urls:
        return all_results

    max_workers = min(10, len(urls))
    logger.info(f"🚀 Running with {max_workers} threads...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(process_single_url, (url, i + 1)): i + 1
            for i, url in enumerate(urls)
        }

        for future in as_completed(futures):
            try:
                all_results.append(future.result())
            except Exception as e:
                idx = futures[future]
                logger.error(f"Error in thread for call {idx}: {e}")

    all_results.sort(key=lambda r: r["call_number"])
    return all_results

def save_separated_outputs(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Save transcripts and analyses separated by application submission status.

    This function creates or appends to four files:
        - applications_submitted_transcripts.txt
        - applications_not_submitted_transcripts.txt
        - applications_submitted_analysis.txt
        - applications_not_submitted_analysis.txt

    Each call that was successfully processed will be written to the appropriate
    transcript and analysis file depending on whether an application was submitted.
    A timestamp and session header are added at the start of each run.
    """
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    # File paths (append mode)
    app_submitted_transcripts = os.path.join(TRANSCRIPTS_FOLDER, "applications_submitted_transcripts.txt")
    app_not_submitted_transcripts = os.path.join(TRANSCRIPTS_FOLDER, "applications_not_submitted_transcripts.txt")
    app_submitted_analysis = os.path.join(ANALYSIS_FOLDER, "applications_submitted_analysis.txt")
    app_not_submitted_analysis = os.path.join(ANALYSIS_FOLDER, "applications_not_submitted_analysis.txt")

    # Counts for reporting
    app_yes_count = sum(1 for r in results if r.get("application_submitted") and r["status"] == "Success")
    app_no_count = sum(1 for r in results if not r.get("application_submitted") and r["status"] == "Success")

    # Write transcripts for calls with submitted applications
    with open(app_submitted_transcripts, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"SESSION: {timestamp}\n")
        f.write(f"{'='*80}\n\n")
        for result in results:
            if result.get("application_submitted") and result["status"] == "Success":
                f.write(f"--- CALL {result['call_number']} (Application Submitted: YES) ---\n")
                f.write(f"URL: {result['url']}\n")
                f.write(f"Timestamp: {timestamp}\n\n")
                f.write("TRANSCRIPT:\n")
                f.write(result["transcript"])
                f.write("\n\n" + "-"*60 + "\n\n")

    # Write transcripts for calls without submitted applications
    with open(app_not_submitted_transcripts, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"SESSION: {timestamp}\n")
        f.write(f"{'='*80}\n\n")
        for result in results:
            if not result.get("application_submitted") and result["status"] == "Success":
                f.write(f"--- CALL {result['call_number']} (Application Submitted: NO) ---\n")
                f.write(f"URL: {result['url']}\n")
                f.write(f"Timestamp: {timestamp}\n\n")
                f.write("TRANSCRIPT:\n")
                f.write(result["transcript"])
                f.write("\n\n" + "-"*60 + "\n\n")

    # Write analysis for calls with submitted applications
    with open(app_submitted_analysis, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"SESSION: {timestamp}\n")
        f.write(f"{'='*80}\n\n")
        for result in results:
            if result.get("application_submitted") and result["status"] == "Success":
                f.write(f"--- CALL {result['call_number']} (Application Submitted: YES) ---\n")
                f.write(f"URL: {result['url']}\n")
                f.write(f"Timestamp: {timestamp}\n\n")
                f.write("ANALYSIS:\n")
                f.write(result["analysis"])
                f.write("\n\n" + "-"*60 + "\n\n")

    # Write analysis for calls without submitted applications
    with open(app_not_submitted_analysis, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"SESSION: {timestamp}\n")
        f.write(f"{'='*80}\n\n")
        for result in results:
            if not result.get("application_submitted") and result["status"] == "Success":
                f.write(f"--- CALL {result['call_number']} (Application Submitted: NO) ---\n")
                f.write(f"URL: {result['url']}\n")
                f.write(f"Timestamp: {timestamp}\n\n")
                f.write("ANALYSIS:\n")
                f.write(result["analysis"])
                f.write("\n\n" + "-"*60 + "\n\n")

    logger.info(f"\n✓ Files saved successfully!")
    logger.info(f"   Applications Submitted (YES): {app_yes_count} calls")
    logger.info(f"   - Transcripts: {app_submitted_transcripts}")
    logger.info(f"   - Analysis:   {app_submitted_analysis}")
    logger.info(f"\n   Applications NOT Submitted (NO): {app_no_count} calls")
    logger.info(f"   - Transcripts: {app_not_submitted_transcripts}")
    logger.info(f"   - Analysis:   {app_not_submitted_analysis}")

    return {
        "app_yes": app_yes_count,
        "app_no": app_no_count,
        "files": {
            "transcripts_yes": app_submitted_transcripts,
            "transcripts_no": app_not_submitted_transcripts,
            "analysis_yes": app_submitted_analysis,
            "analysis_no": app_not_submitted_analysis
        }
    }

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    logger.info("🎯 Faster-Whisper Call Analysis Started")

    urls = read_urls_from_file("urls3.txt")
    if not urls:
        logger.error("No URLs found in urls3.txt")
        sys.exit(1)

    start_time = datetime.datetime.now()
    results = process_all_urls(urls)

    # Save outputs separated by application submission status
    output_info = save_separated_outputs(results)

    duration = (datetime.datetime.now() - start_time).total_seconds()
    logger.info("\n" + "="*70)
    logger.info("✓ PROCESSING COMPLETE")
    logger.info(f"Total URLs: {len(urls)}")
    logger.info(f"Time: {duration:.1f} seconds ({duration/60:.1f} minutes)")
    logger.info(f"Applications Submitted: {output_info['app_yes']}")
    logger.info(f"Applications NOT Submitted: {output_info['app_no']}")
    logger.info("="*70)
