FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (ffmpeg is required for audio processing)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker code
COPY worker.py .

# Environment variables (defaults)
ENV PYTHONUNBUFFERED=1
ENV REDIS_URL=redis://localhost:6379

# Run the worker
CMD ["python", "worker.py"]
