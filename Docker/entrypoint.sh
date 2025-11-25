#!/usr/bin/env bash
set -euo pipefail

COMFY_DIR=${COMFY_DIR:-/workspace}
TORCH_INDEX_URL=${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu128}
export LICENSE_SERVER_URL LICENSE_KEY

APP_DIR="$COMFY_DIR/ComfyUI"
VENV_DIR="$APP_DIR/venv"
VENV_PY="$VENV_DIR/bin/python"

# Trust mounted repositories to avoid Git safe.directory warnings
git config --global --add safe.directory '*' || true

# Ensure base ComfyUI directory exists
mkdir -p "$COMFY_DIR"

# Clone ComfyUI if it doesn't exist
if [ ! -d "$APP_DIR/.git" ]; then
  echo "Cloning ComfyUI..."
  git clone https://github.com/comfyanonymous/ComfyUI.git "$APP_DIR"
else
  echo "ComfyUI already cloned, skipping clone..."
fi

# Clone ComfyUI-Nitra custom node if missing
CUSTOM_NODE_DIR="$APP_DIR/custom_nodes/ComfyUI-Nitra"
if [ ! -d "$CUSTOM_NODE_DIR/.git" ]; then
  echo "Cloning ComfyUI-Nitra custom node..."
  git clone https://github.com/TheArtOfficial/ComfyUI-Nitra.git "$CUSTOM_NODE_DIR"
else
  echo "ComfyUI-Nitra already present, skipping clone..."
fi
echo "Checking out ComfyUI-Nitra stg branch..."
git -C "$CUSTOM_NODE_DIR" fetch origin
git -C "$CUSTOM_NODE_DIR" checkout stg

# Set up venv and install requirements (whether just cloned or already existed)
VENV_PIP="$VENV_DIR/bin/pip"

if [ ! -x "$VENV_PY" ]; then
  echo "Creating Python venv at $VENV_DIR..."
  python3.12 -m venv "$VENV_DIR"
fi

"$VENV_PIP" install --upgrade pip setuptools wheel || true
if [ -f "$APP_DIR/requirements.txt" ]; then
  echo "Installing ComfyUI requirements..."
  "$VENV_PIP" install -r "$APP_DIR/requirements.txt" --extra-index-url "$TORCH_INDEX_URL" || true
fi

# Install ComfyUI-Nitra requirements into the same venv
CUSTOM_REQS="$CUSTOM_NODE_DIR/requirements.txt"
if [ -f "$CUSTOM_REQS" ]; then
  echo "Installing ComfyUI-Nitra requirements..."
  "$VENV_PIP" install -r "$CUSTOM_REQS" || true
fi


# Install JupyterLab using system Python
echo "Installing JupyterLab..."
python3.12 -m pip install jupyterlab pexpect || true

# Start JupyterLab in the background using system Python
echo "Starting JupyterLab on port 8888..."
SHELL=/bin/bash python3.12 -m jupyterlab \
  --ip=0.0.0.0 \
  --port=8888 \
  --no-browser \
  --allow-root \
  --ServerApp.token='' \
  --ServerApp.password='' \
  --ServerApp.terminals_enabled=True \
  --ServerApp.disable_check_xsrf=True \
  --ServerApp.allow_origin='*' \
  --ServerApp.allow_credentials=False &

# GPU monitoring and auto-shutdown (only if SHUTDOWN_CHECK_TIME is set)
if [ -n "${SHUTDOWN_CHECK_TIME:-}" ]; then
  # Parse shutdown time (format: HHMM or HH:MM, e.g., "0300" or "03:00")
  SHUTDOWN_TIME=$(echo "$SHUTDOWN_CHECK_TIME" | tr -d ':')
  if [ ${#SHUTDOWN_TIME} -ne 4 ]; then
    echo "WARNING: SHUTDOWN_CHECK_TIME must be in HHMM or HH:MM format (e.g., 0300 or 03:00), got: $SHUTDOWN_CHECK_TIME"
  else
    SHUTDOWN_HOUR_STR=$(echo "$SHUTDOWN_TIME" | cut -c1-2)
    SHUTDOWN_HOUR=$((10#$SHUTDOWN_HOUR_STR))
    END_CHECK_HOUR=$((SHUTDOWN_HOUR + 1))
    if [ $END_CHECK_HOUR -ge 24 ]; then
      END_CHECK_HOUR=0
    fi
    
    echo "GPU shutdown monitoring enabled: checking at ${SHUTDOWN_TIME} (${SHUTDOWN_HOUR}:00 - ${END_CHECK_HOUR}:00)"
    mkdir -p /var/log
    export SHUTDOWN_TIME SHUTDOWN_HOUR END_CHECK_HOUR
    bash -c '
      shutdown_pod() {
        local pod_id="${RUNPOD_POD_ID:-}"
        if [ -z "$pod_id" ]; then
          echo "ERROR: RUNPOD_POD_ID not set, cannot shutdown pod" >&2
          return 1
        fi
        
        # Try runpodctl first, fallback to API
        if command -v runpodctl >/dev/null 2>&1; then
          echo "Stopping pod $pod_id using runpodctl..."
          runpodctl stop pod "$pod_id" || return 1
        elif [ -n "${RUNPOD_API_KEY:-}" ]; then
          echo "Stopping pod $pod_id using RunPod API..."
          curl -X POST "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"query\": \"mutation { podStop(input: {podId: \\\"$pod_id\\\"}) { id } }\"}" || return 1
        else
          echo "ERROR: Neither runpodctl nor RUNPOD_API_KEY available, cannot shutdown pod" >&2
          return 1
        fi
      }
      
      while true; do
        CURRENT_HOUR_STR=$(date +%H)
        CURRENT_HOUR=$((10#$CURRENT_HOUR_STR))
        CURRENT_TIME=$(date +%H%M)
        
        # If it is after the end check hour, sleep until next shutdown time
        if [ "$CURRENT_HOUR" -ge "$END_CHECK_HOUR" ] || [ "$CURRENT_HOUR" -lt "$SHUTDOWN_HOUR" ]; then
          # Calculate seconds until next shutdown time
          NOW=$(date +%s)
          TARGET_HOUR=$(printf "%02d" "$SHUTDOWN_HOUR")
          TARGET=$(date -d "tomorrow ${TARGET_HOUR}:00" +%s 2>/dev/null || date -d "next day ${TARGET_HOUR}:00" +%s)
          SLEEP_TIME=$((TARGET - NOW))
          if [ $SLEEP_TIME -lt 0 ]; then
            SLEEP_TIME=$((SLEEP_TIME + 86400))  # Add 24 hours if calculation went wrong
          fi
          echo "[$(date)] Sleeping until next ${SHUTDOWN_TIME} check window (in $((SLEEP_TIME / 3600)) hours)..."
          sleep $SLEEP_TIME
          continue
        fi
        
        # We are in the check window
        if [ "$CURRENT_TIME" = "$SHUTDOWN_TIME" ]; then
          echo "[$(date)] Checking GPU utilization at ${SHUTDOWN_TIME}..."
          GPU_UTIL=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n1 | awk "{print int(\$1)}" || echo "0")
          echo "[$(date)] GPU utilization: ${GPU_UTIL}%"
          
          if [ "${GPU_UTIL:-0}" -lt 10 ]; then
            echo "[$(date)] GPU utilization ${GPU_UTIL}% is below 10%, shutting down pod..."
            shutdown_pod && break || echo "[$(date)] Failed to shutdown pod, will retry tomorrow"
          else
            echo "[$(date)] GPU utilization ${GPU_UTIL}% is above 10%, keeping pod running"
          fi
          
          # Wait until after end check hour before stopping checks
          while [ "$CURRENT_HOUR" -lt "$END_CHECK_HOUR" ]; do
            sleep 60
            CURRENT_HOUR_STR=$(date +%H)
            CURRENT_HOUR=$((10#$CURRENT_HOUR_STR))
          done
          echo "[$(date)] ${END_CHECK_HOUR}:00 reached, stopping checks until tomorrow"
        else
          sleep 30  # check every 30 seconds during the check window
        fi
      done
    ' >/var/log/gpu-watch.log 2>&1 &
  fi
else
  echo "SHUTDOWN_CHECK_TIME not set, GPU shutdown monitoring disabled"
fi

# Start ComfyUI in background (without exec so shell stays as PID 1)
"$VENV_PY" "$APP_DIR/main.py" --listen --port 8188 --preview-method auto"$@" &
COMFYUI_PID=$!

# Function to handle cleanup
cleanup() {
    echo "Shutting down..."
    kill $COMFYUI_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for ComfyUI, but keep container alive if it's killed
wait $COMFYUI_PID || {
    echo "ComfyUI process ended. Container will stay alive for JupyterLab."
    # Keep container running for JupyterLab
    while true; do sleep 3600; done
}
