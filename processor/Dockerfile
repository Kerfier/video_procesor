# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

# gcc/g++ required to compile native extensions (scipy, numpy, opencv)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Create a virtual environment; all packages installed here
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy only the manifest first for better layer caching
COPY processor/pyproject.toml ./

# Install CPU-only PyTorch before ultralytics to prevent pip from pulling the
# CUDA variant (~2.5 GB) that ultralytics would otherwise request by default.
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir ".[server]"

# Strip test directories and cached bytecode to shrink the venv
RUN find /opt/venv -type d -name "tests"       -exec rm -rf {} + 2>/dev/null; \
    find /opt/venv -type d -name "test"        -exec rm -rf {} + 2>/dev/null; \
    find /opt/venv -type f -name "*.pyc"       -delete; \
    find /opt/venv -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null; \
    true

# ultralytics pulls in opencv-python as a transitive dep, which conflicts with
# opencv-contrib-python (both provide cv2). Uninstall it, then force-reinstall
# opencv-contrib-python so that cv2/__init__.py and the binary are fully intact
# (pip can leave cv2 broken when both packages fight over the same files).
RUN pip uninstall -y opencv-python 2>/dev/null || true && \
    pip install --no-cache-dir --force-reinstall --no-deps "opencv-contrib-python==4.13.0.92"

# Copy source and do a non-editable install so the package is baked into the venv
COPY processor/video_processor ./video_processor
RUN pip install --no-cache-dir --no-deps .

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime shared libraries required by OpenCV (libGL + GLib + BLAS + TBB)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libopenblas0 \
        libtbb12 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the venv — source is already compiled into site-packages
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

ENV OUTPUT_DIR=/tmp/streams
ENV PORT=8000

EXPOSE 8000

# Health check uses Python stdlib (no curl/wget in slim)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "video_processor.server:app", "--host", "0.0.0.0", "--port", "8000"]
