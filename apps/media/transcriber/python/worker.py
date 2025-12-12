import os
import json
import time
import logging
import uuid
import tempfile
import requests
import redis
import subprocess
import hashlib
import re
import datetime
from faster_whisper import WhisperModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
MODEL_SIZE = os.getenv('WHISPER_MODEL', 'base')
DEVICE = os.getenv('WHISPER_DEVICE', 'cpu')
COMPUTE_TYPE = os.getenv('WHISPER_COMPUTE', 'int8')

# DeepSeek Config
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_ENDPOINT = os.getenv("DEEPSEEK_ENDPOINT", "https://api.deepseek.com/v1/chat/completions")
ANALYSIS_TIMEOUT = int(os.getenv("ANALYSIS_TIMEOUT", "90"))

# FFmpeg Config
MAX_FFMPEG_SECONDS = int(os.getenv("FFMPEG_TIMEOUT", "120"))
LARGE_FILE_THRESHOLD_MB = int(os.getenv("LARGE_FILE_THRESHOLD_MB", "20"))

class TranscriptionWorker:
    def __init__(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        self.model = None
        self.running = False
        self.consumer_group = 'transcriber-group'
        self.consumer_name = f'python-worker-{uuid.uuid4().hex[:8]}'

    def load_model(self):
        logger.info(f"Loading Faster-Whisper model: {MODEL_SIZE} on {DEVICE}...")
        try:
            self.model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
            logger.info("Model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise

    def setup_redis(self):
        try:
            self.redis.xgroup_create('jobs:transcription', self.consumer_group, id='0', mkstream=True)
        except redis.exceptions.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

    def _ffmpeg_available(self) -> bool:
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, check=False)
            return True
        except Exception:
            return False

    def download_audio(self, url: str) -> str:
        """Download audio to temp file; compress if large."""
        try:
            logger.info(f"Downloading: {url}")
            response = requests.get(url, stream=True)
            response.raise_for_status()

            suffix = os.path.splitext(url)[1] or '.wav'
            # Use a named temp file but close it so other processes can access it
            tf = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            with tf as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            audio_file = tf.name

            # Check size and compress if needed
            file_size = os.path.getsize(audio_file)
            if file_size > LARGE_FILE_THRESHOLD_MB * 1024 * 1024 and self._ffmpeg_available():
                mb = file_size / (1024 * 1024)
                logger.info(f"Compressing large file ({mb:.1f} MB) with ffmpeg...")

                compressed_file = audio_file + "_compressed.mp3"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", audio_file,
                    "-acodec", "mp3",
                    "-ab", "32k",
                    "-ar", "16000",
                    "-ac", "1",
                    compressed_file
                ]
                try:
                    subprocess.run(cmd, capture_output=True, check=True, timeout=MAX_FFMPEG_SECONDS)
                    os.remove(audio_file) # Remove original
                    return compressed_file
                except Exception as e:
                    logger.warning(f"ffmpeg failed, using original file. Err: {e}")
                    if os.path.exists(compressed_file):
                        os.remove(compressed_file)

            return audio_file

        except Exception as e:
            logger.error(f"Download failed: {e}")
            raise

    def analyze_transcript(self, transcript: str) -> dict:
        """Analyze transcript using DeepSeek API."""
        if not transcript:
            return {"error": "Empty transcript"}
        if not DEEPSEEK_API_KEY:
            return {"error": "No API key configured"}

        logger.info("Analyzing transcript...")

        # Calculate cutoff date (simplified version of fe-bill.py logic)
        today = datetime.date.today()
        cutoff_year = today.year - 81
        cutoff_date_str = f"{today.strftime('%B %d')}, {cutoff_year}"

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
- Reason (if Not Billable): [State the specific criterion met]

3. Sale or Application Submitted Determination:
Analyze if a final expense application was submitted.
Criteria for Final Expense Application Submitted (Must meet ALL applicable points):
    - Requires collection of:
        - Portion of SSN (last 4, first 5, or full 9).
        - Checking/Savings account (Routing & Account #) OR Credit Card Number.

Output for Application Submission:
- Application Submitted: [Yes/No]
- Reason (if No): [Explain why]

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
                "model": DEEPSEEK_MODEL,
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

            analysis_text = ""
            if "choices" in result and result["choices"]:
                analysis_text = result["choices"][0]["message"]["content"].strip()

            # Extract application submitted status
            app_submitted = False
            match = re.search(r'Application Submitted:\s*(Yes|No)', analysis_text, re.IGNORECASE)
            if match:
                app_submitted = match.group(1).lower() == "yes"

            # Extract billable status
            billable = False
            match_bill = re.search(r'Billable:\s*(Yes|No)', analysis_text, re.IGNORECASE)
            if match_bill:
                billable = match_bill.group(1).lower() == "yes"

            return {
                "text": analysis_text,
                "applicationSubmitted": app_submitted,
                "billable": billable
            }

        except Exception as e:
            logger.error(f"Analysis error: {e}")
            return {"error": str(e)}

    def process_job(self, job_id, job_data):
        logger.info(f"Processing job {job_id} for call {job_data.get('callId')}")
        start_time = time.time()
        temp_file = None

        try:
            # 1. Download
            recording_url = job_data.get('recordingUrl')
            if not recording_url:
                raise ValueError("No recordingUrl provided")

            temp_file = self.download_audio(recording_url)

            # 2. Transcribe
            logger.info("Starting transcription...")
            segments, info = self.model.transcribe(
                temp_file,
                beam_size=5,
                language=job_data.get('settings', {}).get('language', 'en'),
                vad_filter=True
            )

            # Collect results
            transcript_segments = []
            full_text = []

            for segment in segments:
                transcript_segments.append({
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text.strip(),
                    'speaker': None
                })
                full_text.append(segment.text.strip())

            full_transcript_text = " ".join(full_text)

            # 3. Analyze
            analysis_result = self.analyze_transcript(full_transcript_text)

            result = {
                'ok': True,
                'jobId': job_data.get('jobId'),
                'callId': job_data.get('callId'),
                'tenantId': job_data.get('tenantId'),
                'engine': 'faster-whisper',
                'language': info.language,
                'durationSec': info.duration,
                'fullText': full_transcript_text,
                'segments': transcript_segments,
                'stats': {
                    'numSegments': len(transcript_segments),
                    'numWords': len(full_transcript_text.split()),
                    'latencyMs': int((time.time() - start_time) * 1000)
                },
                'analysis': analysis_result
            }

            # 4. Publish result
            self.redis.xadd('jobs:transcription:results', {'payload': json.dumps(result)})
            logger.info(f"Job {job_id} completed successfully.")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            error_result = {
                'ok': False,
                'jobId': job_data.get('jobId'),
                'callId': job_data.get('callId'),
                'tenantId': job_data.get('tenantId'),
                'error': str(e)
            }
            self.redis.xadd('jobs:transcription:results', {'payload': json.dumps(error_result)})
        finally:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except:
                    pass

    def run(self):
        self.load_model()
        self.setup_redis()
        self.running = True

        logger.info(f"Worker {self.consumer_name} started. Waiting for jobs...")

        while self.running:
            try:
                entries = self.redis.xreadgroup(
                    self.consumer_group,
                    self.consumer_name,
                    {'jobs:transcription': '>'},
                    count=1,
                    block=1000
                )

                if not entries:
                    continue

                for stream, messages in entries:
                    for message_id, fields in messages:
                        try:
                            payload = json.loads(fields['payload'])
                            self.process_job(message_id, payload)
                            self.redis.xack('jobs:transcription', self.consumer_group, message_id)
                        except Exception as e:
                            logger.error(f"Error processing message {message_id}: {e}")
                            self.redis.xack('jobs:transcription', self.consumer_group, message_id)

            except Exception as e:
                logger.error(f"Worker loop error: {e}")
                time.sleep(1)

if __name__ == "__main__":
    worker = TranscriptionWorker()
    worker.run()
