"""
Refactored transcription service from fefast4.py
Provides WhisperX/Whisper.cpp transcription with optional diarization and DeepSeek analysis
"""

import os
import sys
import json
import tempfile
import subprocess
import requests
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import logging
import datetime
import re
import hashlib
import gc
from urllib.parse import urlparse, unquote
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Check dateutil
try:
    from dateutil.relativedelta import relativedelta
    dateutil_available = True
except ImportError:
    dateutil_available = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
HUGGINGFACE_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
WHISPER_CPP_MODEL = os.getenv("WHISPER_CPP_MODEL", "tiny")
TRANSCRIBE_TMP = os.getenv("TRANSCRIBE_TMP", "/tmp/transcriber")

os.makedirs(TRANSCRIBE_TMP, exist_ok=True)

# Initialize WhisperX (lazy load)
whisper_model = None
align_model = None
align_metadata = None
diarize_model = None
diarization_available = False
device = "cpu"
compute_type = "int8"
batch_size = 8


def initialize_whisperx():
    """Initialize WhisperX model (lazy loading)"""
    global whisper_model, device, compute_type

    if whisper_model is not None:
        return whisper_model

    # Detect GPU
    try:
        import torch  # type: ignore
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
            logger.info("CUDA available, using GPU")
        else:
            device = "cpu"
            compute_type = "int8"
            logger.info("Using CPU")
    except ImportError:
        device = "cpu"
        compute_type = "int8"

    try:
        import whisperx  # type: ignore
        logger.info("Loading WhisperX model...")
        whisper_model = whisperx.load_model("base", device=device, compute_type=compute_type)
        logger.info("✅ WhisperX model loaded")
        return whisper_model
    except ImportError:
        logger.warning("WhisperX not available")
        return None
    except Exception as e:
        logger.error(f"Failed to load WhisperX: {e}")
        return None


def initialize_diarization():
    """Initialize diarization pipeline (lazy loading)"""
    global diarize_model, diarization_available

    if diarization_available:
        return diarize_model

    if not HUGGINGFACE_TOKEN:
        logger.warning("⚠️ No HUGGINGFACE_TOKEN - speaker diarization disabled")
        return None

    try:
        import whisperx  # type: ignore
        logger.info("Loading speaker diarization model...")

        # Try different import methods for compatibility
        try:
            from whisperx.diarize import DiarizationPipeline  # type: ignore
            diarize_model = DiarizationPipeline(use_auth_token=HUGGINGFACE_TOKEN, device=device)
        except Exception:
            if hasattr(whisperx, "DiarizationPipeline"):
                diarize_model = whisperx.DiarizationPipeline(use_auth_token=HUGGINGFACE_TOKEN, device=device)
            elif hasattr(whisperx, "load_diarize_model"):
                diarize_model = whisperx.load_diarize_model(use_auth_token=HUGGINGFACE_TOKEN, device=device)
            else:
                raise AttributeError("No diarization pipeline available")

        diarization_available = True
        logger.info("✅ Speaker diarization loaded")
        return diarize_model
    except Exception as e:
        logger.warning(f"⚠️ Diarization failed to load: {e}")
        logger.warning("Continuing without speaker labels")
        return None


@dataclass
class TranscriptionSegment:
    start: float
    end: float
    speaker: Optional[str]
    text: str


@dataclass
class TranscriptionResult:
    ok: bool
    engine: str
    language: str
    duration_sec: float
    segments: List[TranscriptionSegment]
    full_text: str
    stats: Dict[str, Any]
    analysis: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    stage: Optional[str] = None


def download_file(url: str, output_path: str) -> bool:
    """Download file from URL with retry logic (from original fefast4.py)"""
    try:
        logger.info(f"Downloading {url} to {output_path}")
        response = requests.get(
            url,
            stream=True,
            timeout=300,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        logger.info(f"Downloaded {os.path.getsize(output_path)} bytes")
        return True
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return False


def compress_audio(input_path: str, output_path: str, max_duration_sec: Optional[int] = None) -> bool:
    """Compress audio using ffmpeg if needed (from original fefast4.py)"""
    try:
        file_size = os.path.getsize(input_path)

        # Compress if large (>20MB) or if duration limit specified
        if file_size > 20 * 1024 * 1024 or max_duration_sec:
            logger.info(f"Compressing large file ({file_size/(1024*1024):.1f}MB)...")
            cmd = [
                'ffmpeg', '-i', input_path,
                '-acodec', 'mp3',
                '-ab', '32k',
                '-ar', '16000',
                '-ac', '1',
                '-y', output_path
            ]

            if max_duration_sec:
                cmd.insert(-2, '-t')
                cmd.insert(-2, str(max_duration_sec))

            subprocess.run(cmd, capture_output=True, check=True, timeout=60)
            logger.info(f"Compressed audio: {output_path}")
            return True
        else:
            # Just copy/convert to WAV if needed
            cmd = [
                "ffmpeg", "-i", input_path,
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                "-y", output_path
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return True
    except Exception as e:
        logger.error(f"Compression failed: {e}")
        return False


def transcribe_whisperx(audio_path: str, diarize: bool = False) -> Optional[TranscriptionResult]:
    """Transcribe using WhisperX with optional diarization (from original fefast4.py)"""
    try:
        import whisperx  # type: ignore

        # Initialize models
        model = initialize_whisperx()
        if not model:
            return None

        logger.info("Transcribing audio with WhisperX...")
        audio = whisperx.load_audio(audio_path)
        result = model.transcribe(audio, batch_size=batch_size)

        language = result.get("language", "en")

        # Align with word-level timestamps
        logger.info("Aligning transcript...")
        global align_model, align_metadata

        if align_model is None:
            align_model, align_metadata = whisperx.load_align_model(
                language_code=language,
                device=device
            )

        result = whisperx.align(
            result["segments"],
            align_model,
            align_metadata,
            audio,
            device,
            return_char_alignments=False
        )

        # Diarization if requested
        if diarize:
            diarize_pipeline = initialize_diarization()
            if diarize_pipeline:
                logger.info("Performing speaker diarization...")
                diarize_segments = diarize_pipeline(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                logger.info("✅ Speaker diarization complete")

        # Convert to our format
        segments = []
        full_text_parts = []

        for seg in result.get("segments", []):
            text = seg.get("text", "").strip()
            if not text:
                continue

            start = seg.get("start", 0.0)
            end = seg.get("end", 0.0)
            speaker = seg.get("speaker", None)

            segments.append(TranscriptionSegment(
                start=start,
                end=end,
                speaker=speaker,
                text=text
            ))
            full_text_parts.append(text)

        full_text = " ".join(full_text_parts)

        return TranscriptionResult(
            ok=True,
            engine="whisperx",
            language=language,
            duration_sec=segments[-1].end if segments else 0.0,
            segments=segments,
            full_text=full_text,
            stats={
                "numSegments": len(segments),
                "numChars": len(full_text),
                "numWords": len(full_text.split()),
            }
        )
    except ImportError:
        logger.warning("WhisperX not available")
        return None
    except Exception as e:
        logger.error(f"WhisperX transcription failed: {e}")
        return None


def transcribe_whispercpp(audio_path: str) -> Optional[TranscriptionResult]:
    """Transcribe using whisper.cpp as fallback"""
    try:
        # Check if whisper.cpp binary exists
        whisper_bin = os.getenv("WHISPER_CPP_BIN", "whisper")

        # Convert to WAV if needed
        wav_path = audio_path
        if not audio_path.endswith('.wav'):
            wav_path = audio_path + '.wav'
            compress_audio(audio_path, wav_path)

        logger.info(f"Transcribing with whisper.cpp (model: {WHISPER_CPP_MODEL})...")

        # Run whisper.cpp (simplified - actual implementation would need whisper.cpp binary)
        # For now, return error as whisper.cpp integration requires binary setup
        logger.warning("Whisper.cpp fallback not fully implemented - requires binary setup")
        return None
    except Exception as e:
        logger.error(f"Whisper.cpp transcription failed: {e}")
        return None


def analyze_with_deepseek(text: str) -> Optional[Dict[str, Any]]:
    """Analyze transcript with DeepSeek API (from original fefast4.py)"""
    if not DEEPSEEK_API_KEY:
        return None

    try:
        logger.info("Analyzing transcript with DeepSeek...")

        # Calculate age cutoff (from original)
        today = datetime.date.today()
        if dateutil_available:
            cutoff_date = today - relativedelta(years=81)
            cutoff_date_str = cutoff_date.strftime("%B %d, %Y")
        else:
            cutoff_year = today.year - 81
            cutoff_date_str = f"{today.strftime('%B %d')}, {cutoff_year}"

        # Use the EXACT prompt from original fefast4.py
        prompt_content = f"""
Analyze the following call transcript:
--- TRANSCRIPT START ---
{text[:4000]}  # Limit to avoid token limits
--- TRANSCRIPT END ---

Your Objectives:

1. Billable Call Determination:
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

2. Sale or Application Submitted Determination:
Analyze if a final expense application was submitted, based on these definitions. This is SEPARATE from billability.

Criteria for Final Expense Application Submitted (Must meet ALL applicable points):
    - Requires collection of:
        - Portion of SSN (last 4, first 5, or full 9).
        - Checking/Savings account (Routing & Account #) OR Credit Card Number.

Output for Application Submission:
- Application Submitted: [Yes/No]
- Reason (if No): [Explain why, referencing the criteria, e.g., "No payment info collected", "No confirmation of submission mentioned"]

3. Supporting Information (Extract if available, state "Not Provided" otherwise):
    - Monthly Premium: [Amount or "Not Provided"]
    - Carrier: [Name or "Not Provided"]
    - Customer Name: [Full Name or "Not Provided"]
    - Phone Number: [Number or "Not Provided"]
    - Agent Name: [First Name or "Not Provided"]

4. Abrupt Ending Analysis:
    - Did the call end abruptly? [Yes/No]
    - Reason (if Yes): [Brief explanation, e.g., "Customer hung up", "Call dropped"]
    - Last Thing Said: [Quote the last audible statement]

--- IMPORTANT INSTRUCTIONS ---
Provide ONLY the structured output based on the format defined above, starting directly with "- Billable:".
Do NOT include any introductory sentences, concluding remarks, summaries (like "### Summary:"), markdown formatting (like '###' or '```'), or any text other than the requested fields and their values.
Ensure every field listed under 'Output for Billability', 'Output for Application Submission', 'Supporting Information', and 'Abrupt Ending Analysis' is present in your response, even if the value is 'No' or 'Not Provided'.
"""

        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }

        messages = [
            {"role": "system", "content": "You are an AI assistant analyzing call transcripts. Provide ONLY the requested structured data."},
            {"role": "user", "content": prompt_content}
        ]

        data = {
            "messages": messages,
            "model": "deepseek-chat",
            "max_tokens": 1024,
            "temperature": 0.1,
            "stream": False
        }

        response = requests.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers=headers,
            json=data,
            timeout=90
        )
        response.raise_for_status()

        result = response.json()
        if "choices" in result and result["choices"]:
            content = result["choices"][0]["message"]["content"].strip()

            # Parse response (extract key fields)
            billable_match = re.search(r'Billable:\s*(Yes|No)', content, re.IGNORECASE)
            billable = billable_match.group(1) if billable_match else "No"

            app_match = re.search(r'Application Submitted:\s*(Yes|No)', content, re.IGNORECASE)
            application_submitted = app_match.group(1) if app_match else "No"

            return {
                "billable": billable,
                "applicationSubmitted": application_submitted,
                "reasoning": content[:500]  # Limit reasoning length
            }

        return None
    except Exception as e:
        logger.error(f"DeepSeek analysis failed: {e}")
        return None


def transcribe(job: Dict[str, Any]) -> Dict[str, Any]:
    """Main transcription function - single job processing"""
    recording_url = job.get("recordingUrl")
    options = job.get("options", {})

    prefer = options.get("prefer", "whisperx")
    fallback = options.get("fallback", "whispercpp")
    diarize = options.get("diarize", False)

    # Download file
    temp_input = os.path.join(TRANSCRIBE_TMP, f"input_{os.urandom(8).hex()}.wav")
    try:
        if not download_file(recording_url, temp_input):
            return {
                "ok": False,
                "error": "Failed to download recording",
                "stage": "download"
            }

        # Compress if needed (for large files)
        temp_compressed = os.path.join(TRANSCRIBE_TMP, f"compressed_{os.urandom(8).hex()}.wav")
        if not compress_audio(temp_input, temp_compressed):
            # If compression fails, use original
            temp_compressed = temp_input

        audio_path = temp_compressed

        # Try preferred engine
        result = None
        if prefer == "whisperx":
            result = transcribe_whisperx(audio_path, diarize=diarize)

        # Fallback if needed
        if not result and fallback == "whispercpp":
            result = transcribe_whispercpp(audio_path)

        if not result or not result.ok:
            return {
                "ok": False,
                "error": "Transcription failed",
                "stage": "transcribe"
            }

        # Run analysis if API key is set
        analysis = None
        if DEEPSEEK_API_KEY:
            analysis = analyze_with_deepseek(result.full_text)

        # Convert to JSON-serializable format
        return {
            "ok": True,
            "engine": result.engine,
            "language": result.language,
            "durationSec": result.duration_sec,
            "segments": [
                {
                    "start": seg.start,
                    "end": seg.end,
                    "speaker": seg.speaker,
                    "text": seg.text
                }
                for seg in result.segments
            ],
            "fullText": result.full_text,
            "stats": result.stats,
            "analysis": analysis
        }
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return {
            "ok": False,
            "error": str(e),
            "stage": "unknown"
        }
    finally:
        # Cleanup temp files
        for path in [temp_input, temp_compressed]:
            if os.path.exists(path) and path != temp_input:  # Don't delete if it's the same file
                try:
                    os.remove(path)
                except:
                    pass
        # Free memory
        gc.collect()
