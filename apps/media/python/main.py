#!/usr/bin/env python3
"""
Python sidecar main entry point
Reads JSON job from stdin, writes JSON result to stdout
"""

import sys
import json
import logging
from fefast4 import transcribe

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def main():
    """Read job from stdin, process, write result to stdout."""
    try:
        # Read JSON from stdin
        input_data = json.load(sys.stdin)
        
        logger.info(f"Received job: {input_data.get('job')}")
        
        # Validate job
        if input_data.get("job") != "transcribe":
            result = {
                "ok": False,
                "error": "Invalid job type",
                "stage": "validation"
            }
        else:
            # Process transcription
            result = transcribe(input_data)
        
        # Write result to stdout
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        sys.stdout.flush()
        
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON input: {e}")
        result = {
            "ok": False,
            "error": f"Invalid JSON: {e}",
            "stage": "parse"
        }
        json.dump(result, sys.stdout)
        sys.stdout.write("\n")
        sys.stdout.flush()
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        result = {
            "ok": False,
            "error": str(e),
            "stage": "unknown"
        }
        json.dump(result, sys.stdout)
        sys.stdout.write("\n")
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()

