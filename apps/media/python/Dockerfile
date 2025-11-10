FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY fefast4.py .
COPY main.py .

# Create non-root user
RUN useradd -m -u 1000 transcriber && \
    chown -R transcriber:transcriber /app

USER transcriber

# Default command
ENTRYPOINT ["python", "main.py"]

