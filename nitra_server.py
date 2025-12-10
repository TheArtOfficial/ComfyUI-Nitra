"""
Nitra Custom Node Server Routes
Follows the exact same pattern as ComfyUI-Manager for route registration
"""

import logging
import os
import time
import sys
import json
import unicodedata
import asyncio
import threading
import subprocess
import signal
import atexit
import socket
import platform
import uuid
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple, Union
try:
    import keyring
    from keyring.errors import KeyringError
except Exception:  # pragma: no cover - keyring should be available via requirements
    keyring = None

    class KeyringError(Exception):
        """Fallback KeyringError when keyring is unavailable."""
        pass
from server import PromptServer
from aiohttp import web

# Use both logging and print for debugging
logger = logging.getLogger(__name__)
LOG_DIR = os.path.join(os.path.dirname(__file__), 'web', 'logs')
PIP_LOG_PATH = os.path.join(LOG_DIR, 'setup.log')

def _log_pip_output(label: str, content: Optional[str]) -> None:
    if not content:
        return
    logger.info("%s\n%s", label, content.strip())
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(PIP_LOG_PATH, 'a', encoding='utf-8') as log_file:
            timestamp = datetime.now(timezone.utc).isoformat()
            log_file.write(f"\n[{timestamp}] {label}\n")
            log_file.write(content)
            if not content.endswith('\n'):
                log_file.write('\n')
    except Exception as log_error:
        logger.warning("Nitra: Failed to write pip logs: %s", log_error)

# Configuration - Automatically detect from git branch
def get_git_branch() -> str:
    """Detect the current git branch"""
    try:
        import subprocess
        result = subprocess.run(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return 'main'  # Default fallback

def load_config():
    """Load configuration based on git branch"""
    # Branch to URL mapping
    branch_urls = {
        'main': 'https://app.nitralabs.ai',
        'stg': 'https://appstaging.nitralabs.ai',
        'dev': 'http://localhost:3000',
    }
    
    # Environment variable override (highest priority - for Docker/serverless)
    if os.environ.get('NITRA_WEBSITE_URL'):
        website_url = os.environ.get('NITRA_WEBSITE_URL')
        logger.info(f"Nitra: Using URL from env var: {website_url}")
        return {
            'website_base_url': website_url,
            'environment': 'custom',
            'use_local_scripts': False
        }
    
    # Detect from git branch
    branch = get_git_branch()
    website_url = branch_urls.get(branch.lower(), 'http://localhost:3000')
    
    logger.info(f"Nitra: Detected branch '{branch}' → {website_url}")
    
    return {
        'website_base_url': website_url,
        'environment': branch,
        'use_local_scripts': False
    }

# Load configuration
config = load_config()
WEBSITE_BASE_URL = config['website_base_url']
USE_LOCAL_SCRIPTS = config['use_local_scripts']

DEVICE_TOKEN_KEYRING_SERVICE = "comfyui-nitra-device-token"
_cached_device_token: Optional[str] = None


def detect_nvcc_driver_version() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Detect nvcc version by probing common locations."""
    candidates: List[str] = []
    if os.name == 'nt':
        for key, value in os.environ.items():
            if key.upper().startswith('CUDA_PATH') and value:
                nvcc_path = Path(value) / 'bin' / 'nvcc.exe'
                candidates.append(str(nvcc_path))
    else:
        candidates.append('/usr/local/cuda/bin/nvcc')

    candidates.append('nvcc')
    seen = set()

    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)

        path_obj = Path(candidate)
        if candidate != 'nvcc' and not path_obj.exists():
            continue

        try:
            result = subprocess.run(
                [candidate, '--version'],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except FileNotFoundError:
            continue
        except Exception:
            continue

        if result.returncode != 0:
            continue

        output = result.stdout or result.stderr or ''
        match = re.search(r'release\s+(\d+\.\d+)', output)
        if match:
            return match.group(1), candidate, output.strip()

    return None, None, None

def get_python_cmd() -> List[str]:
    """
    Get the proper Python command for running scripts
    
    Note: We don't use -s flag here because it prevents PYTHONPATH from working.
    The -s flag is only needed for pip operations (handled in config.py)
    
    Returns:
        List of command parts for running Python
    """
    return [sys.executable]

def debug_log(message):
    """
    Debug logging with basic redaction:
    - Suppress console printing for sensitive/noisy details (tokens, paths, full payloads)
    - Still log everything to debug, but only surface user-relevant messages to stdout
    """
    try:
        msg_str = str(message)
        lowered = msg_str.lower()
        noisy_keys = [
            "token", "request data", "options", "script path", "script directory",
            "detected comfyui root", "working directory", "env", "payload", "args:",
            "loaded node mappings", "parsed data", "skipping local script validation",
            "starting workflow_downloader", "status/update"
        ]
        allow_keys = [
            "install", "installation", "custom node", "models", "summary", "download",
            "✓", "✗", "error", "failed"
        ]
        is_noisy = any(k in lowered for k in noisy_keys)
        is_allowed = any(k in lowered for k in allow_keys)
        logger.debug(f"Nitra: {msg_str}")
        if is_allowed and not is_noisy:
            print(f"Nitra: {msg_str}", flush=True)
    except Exception:
        # If logging fails, fail silently
        pass


def _mask_token_preview(token: Optional[str]) -> str:
    """Return a redacted preview of sensitive tokens for logging."""
    if not token:
        return "<none>"
    if len(token) <= 8:
        return "***"
    return f"{token[:4]}...{token[-4:]}"


def handle_stream(stream, prefix):
    """Handle subprocess output streaming to terminal (from ComfyUI-Manager)"""
    import sys
    stream.reconfigure(encoding='utf-8', errors='replace')
    
    # Read character by character to handle progress bars that use \r without \n
    buffer = ""
    while True:
        char = stream.read(1)
        if not char:
            break
            
        buffer += char
        
        # On carriage return or newline, process the line
        if char in ['\r', '\n']:
            if buffer.strip():
                msg = buffer
                # Handle progress bars and download progress
                if ('it/s]' in msg or 's/it]' in msg or 'Downloading' in msg or '%' in msg) and ('%|' in msg or 'it [' in msg or 'MB' in msg or 'GB' in msg):
                    # Print with carriage return to allow overwriting
                    print('\r' + msg.rstrip(), end="", file=sys.stderr)
                    sys.stderr.flush()
                # Handle regular output
                else:
                    if prefix == '[!]':
                        print(prefix, msg, end="", file=sys.stderr)
                        sys.stderr.flush()
                    else:
                        print(prefix, msg, end="")
                        sys.stdout.flush()
            
            # Clear buffer on newline, keep on carriage return
            if char == '\n':
                buffer = ""
            elif char == '\r':
                buffer = ""

# Register routes directly on PromptServer.instance - EXACT ComfyUI-Manager pattern
routes = PromptServer.instance.routes

# Config endpoint - provides frontend with server configuration
@routes.get('/nitra/config')
async def get_config(request):
    """Return configuration for frontend - single source of truth"""
    return web.json_response({
        'websiteBaseUrl': WEBSITE_BASE_URL
    })

@routes.get('/nitra/check-versions')
async def check_versions(request):
    """Check installed versions of Visual Studio Build Tools, Python, and Windows-Triton"""
    try:
        import platform
        os_type = platform.system()
        logger.info(f"Nitra: OS detection - platform.system() returned: {os_type}")
        
        versions = {
            'os': os_type,
            'vs_build_tools': {'installed': False, 'version': None},
            'python': {'version': None},
            'torch': {'installed': False, 'version': None},
            'cudaDriver': {'version': None, 'path': None, 'raw': None},
            'triton': {'installed': False, 'version': None},
            'windows_triton': {'installed': False, 'version': None, 'latest_version': None},
            'sageattention': {'installed': False, 'version': None, 'latest_version': None},
            'onnx': {'installed': False, 'version': None, 'latest_version': None},
            'onnxruntime': {'installed': False, 'version': None},
            'onnxruntime_gpu': {'installed': False, 'version': None, 'latest_version': None}
        }
        
        logger.info(f"Nitra: Versions response will include OS: {os_type}")
        
        # Check Python version
        try:
            import platform
            versions['python']['version'] = platform.python_version()
        except Exception as e:
            logger.warning(f"Failed to get Python version: {e}")
        
        # Check Visual Studio Build Tools (Windows only)
        try:
            import platform
            if platform.system() == 'Windows':
                # Check if Visual Studio Build Tools are installed
                result = subprocess.run(
                    ['winget', 'list', '--id', 'Microsoft.VisualStudio.2022.BuildTools'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode == 0 and 'BuildTools' in result.stdout:
                    versions['vs_build_tools']['installed'] = True
        except Exception as e:
            logger.warning(f"Failed to check VS Build Tools: {e}")
        
        # Check PyTorch version (fast - direct import)
        try:
            import torch
            versions['torch']['installed'] = True
            versions['torch']['version'] = torch.__version__
            # Get CUDA version from torch
            if torch.cuda.is_available():
                versions['cuda'] = {'version': torch.version.cuda}
            else:
                versions['cuda'] = {'version': None}
        except ImportError:
            versions['cuda'] = {'version': None}
        except Exception as e:
            logger.warning(f"Failed to check PyTorch: {e}")
            versions['cuda'] = {'version': None}

        nvcc_version, nvcc_path, nvcc_output = detect_nvcc_driver_version()
        versions['cudaDriver'] = {
            'version': nvcc_version,
            'path': nvcc_path,
            'raw': nvcc_output,
        }
        
        # Check regular Triton (for Linux/Mac)
        try:
            result = subprocess.run(
                [sys.executable, '-m', 'pip', 'show', 'triton'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                versions['triton']['installed'] = True
                # Parse version from pip show output
                for line in result.stdout.split('\n'):
                    if line.startswith('Version:'):
                        versions['triton']['version'] = line.split(':', 1)[1].strip()
                        break
        except Exception as e:
            logger.warning(f"Failed to check Triton: {e}")
        
        # Check Windows-Triton installation (use pip show for full version including post-release)
        try:
            # On Windows, ONLY check for 'triton-windows' package (not 'triton')
            # On Linux/Mac, check for 'triton' package
            import platform
            is_windows = platform.system().lower() == 'windows'
            
            if is_windows:
                # Windows: Only check for 'triton-windows'
                package_name = 'triton-windows'
            else:
                # Linux/Mac: Check for 'triton'
                package_name = 'triton'
            
            triton_version = None
            
            result = subprocess.run(
                [sys.executable, '-m', 'pip', 'show', package_name],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                for line in result.stdout.split('\n'):
                    if line.startswith('Version:'):
                        triton_version = line.split(':', 1)[1].strip()
                        logger.info(f"Triton version retrieved from pip ({package_name}): {triton_version}")
                        break
            
            if triton_version:
                versions['windows_triton']['installed'] = True
                versions['windows_triton']['version'] = triton_version
            elif not is_windows:
                # Fallback to direct import only on non-Windows systems
                import importlib.util
                spec = importlib.util.find_spec('triton')
                if spec is not None:
                    import triton
                    triton_version = getattr(triton, '__version__', 'unknown')
                    logger.info(f"Triton version retrieved from module: {triton_version}")
                    versions['windows_triton']['installed'] = True
                    versions['windows_triton']['version'] = triton_version
        except Exception as e:
            logger.warning(f"Failed to check Windows-Triton: {e}")
        
        # Check Sageattention installation (use pip show for custom version format)
        try:
            result = subprocess.run(
                [sys.executable, '-m', 'pip', 'show', 'sageattention'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                versions['sageattention']['installed'] = True
                # Parse version from pip show output (handles custom format like 2.2.0+cu128torch2.8.0.post3)
                for line in result.stdout.split('\n'):
                    if line.startswith('Version:'):
                        versions['sageattention']['version'] = line.split(':', 1)[1].strip()
                        break
        except Exception as e:
            logger.warning(f"Failed to check Sageattention: {e}")
        
        # Check onnx installation (fast - direct import)
        try:
            import importlib.util
            spec = importlib.util.find_spec('onnx')
            if spec is not None:
                import onnx
                versions['onnx']['installed'] = True
                versions['onnx']['version'] = getattr(onnx, '__version__', 'unknown')
        except Exception as e:
            logger.warning(f"Failed to check onnx: {e}")
        
        # Check onnxruntime installation (CPU version - should NOT be installed if GPU is)
        try:
            import importlib.util
            spec = importlib.util.find_spec('onnxruntime')
            if spec is not None:
                import onnxruntime as ort
                # Check if it's the CPU-only version (no CUDA providers)
                providers = ort.get_available_providers()
                if 'CUDAExecutionProvider' not in providers and 'TensorrtExecutionProvider' not in providers:
                    versions['onnxruntime']['installed'] = True
                    versions['onnxruntime']['version'] = getattr(ort, '__version__', 'unknown')
        except Exception as e:
            logger.warning(f"Failed to check onnxruntime: {e}")
        
        # Check onnxruntime-gpu installation (GPU version - check for CUDA providers)
        try:
            import importlib.util
            spec = importlib.util.find_spec('onnxruntime')
            if spec is not None:
                import onnxruntime as ort
                # Check if it's the GPU version by looking for CUDA execution provider
                providers = ort.get_available_providers()
                if 'CUDAExecutionProvider' in providers or 'TensorrtExecutionProvider' in providers:
                    versions['onnxruntime_gpu']['installed'] = True
                    versions['onnxruntime_gpu']['version'] = getattr(ort, '__version__', 'unknown')
        except Exception as e:
            logger.warning(f"Failed to check onnxruntime-gpu: {e}")
        
        return web.json_response(versions)
        
    except Exception as e:
        logger.error(f"Error checking versions: {e}")
        return web.json_response({'error': str(e)}, status=500)

# Global storage for active updates
nitra_active_updates = {}

# Global task queue system (ComfyUI-Manager pattern)
import queue
task_queue = queue.Queue()
tasks_in_progress = set()
task_worker_lock = threading.Lock()
task_worker_thread = None

# Track running processes for cancellation
running_processes = {}  # task_id -> process_info

WINDOWS_CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == 'nt' else 0
_previous_signal_handlers: Dict[int, Any] = {}
_shutdown_handlers_registered = False
_aiohttp_shutdown_registered = False


def _terminate_child_process(proc: subprocess.Popen, task_id: str) -> None:
    """Attempt to terminate a tracked subprocess gracefully, then forcefully."""
    if proc is None or proc.poll() is not None:
        return

    try:
        if os.name == 'nt':
            try:
                proc.send_signal(signal.CTRL_BREAK_EVENT)
                proc.wait(timeout=5)
                return
            except Exception:
                pass

        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _join_thread_safely(thread: Optional[threading.Thread]) -> None:
    """Join a thread with a small timeout to avoid blocking shutdown."""
    if thread and thread.is_alive():
        try:
            thread.join(timeout=1)
        except Exception:
            pass


def _cleanup_running_processes() -> None:
    """Terminate all tracked subprocesses and join their streaming threads."""
    with task_worker_lock:
        entries = list(running_processes.items())
        running_processes.clear()
        tasks_in_progress.clear()

    for task_id, info in entries:
        proc = info.get('process')
        _terminate_child_process(proc, task_id)

        _join_thread_safely(info.get('stdout_thread'))
        _join_thread_safely(info.get('stderr_thread'))

        script_runner = info.get('script_runner')
        if script_runner:
            try:
                script_runner.cleanup()
            except Exception:
                pass


async def _aiohttp_cleanup_callback(app) -> None:
    """aiohttp on_shutdown hook to clean up background processes."""
    _cleanup_running_processes()


def _register_promptserver_shutdown() -> None:
    """Register cleanup hook with PromptServer's aiohttp app if available."""
    global _aiohttp_shutdown_registered
    if _aiohttp_shutdown_registered:
        return

    try:
        prompt_server = PromptServer.instance
    except Exception:
        return

    app = getattr(prompt_server, "app", None)
    on_shutdown = getattr(app, "on_shutdown", None)
    if on_shutdown is None:
        return

    if _aiohttp_cleanup_callback not in on_shutdown:
        on_shutdown.append(_aiohttp_cleanup_callback)
        _aiohttp_shutdown_registered = True


def _register_shutdown_handlers() -> None:
    """Register signal and exit handlers to ensure subprocess cleanup."""
    global _shutdown_handlers_registered
    if _shutdown_handlers_registered:
        return

    atexit.register(_cleanup_running_processes)

    def _handle_signal(signum, frame):
        _cleanup_running_processes()
        previous = _previous_signal_handlers.get(signum)
        if callable(previous) and previous is not _handle_signal:
            previous(signum, frame)
        elif previous == signal.SIG_DFL or previous is None:
            raise SystemExit(0)

    for sig in filter(None, (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGBREAK", None))):
        try:
            previous = signal.getsignal(sig)
            _previous_signal_handlers[sig] = previous
            signal.signal(sig, _handle_signal)
        except Exception:
            continue

    _register_promptserver_shutdown()
    _shutdown_handlers_registered = True


_register_shutdown_handlers()

def task_worker():
    """Worker thread that processes tasks from the queue (ComfyUI-Manager pattern)"""
    global task_worker_thread
    
    while True:
        try:
            with task_worker_lock:
                if task_queue.empty():
                    task_worker_thread = None
                    return  # terminate worker thread
                
                task_type, task_data = task_queue.get()
                tasks_in_progress.add((task_type, task_data['id']))
            
            # Execute the task
            if task_type == 'workflow':
                execute_workflow_task(task_data)
            elif task_type == 'model':
                execute_model_task(task_data)
            
            # Remove from in-progress
            with task_worker_lock:
                tasks_in_progress.discard((task_type, task_data['id']))
                
        except Exception as e:
            debug_log(f"Error in task worker: {e}")
            with task_worker_lock:
                if (task_type, task_data['id']) in tasks_in_progress:
                    tasks_in_progress.discard((task_type, task_data['id']))

def execute_workflow_task(task_data):
    """Execute a workflow installation task using script runner system"""
    task_id = task_data['id']
    _register_promptserver_shutdown()
    try:
        # Extract data from task
        workflow_ids = task_data.get('workflow_ids', [])
        hf_token = task_data.get('hf_token', '')
        env = task_data['env']
        cwd = task_data['cwd']
        
        # Extract user info from environment
        user_id = env.get('NITRA_USER_ID', 'unknown')
        user_email = env.get('NITRA_USER_EMAIL', 'unknown')
        access_token = env.get('NITRA_ACCESS_TOKEN', '')
        
        
        # Use script runner system for S3 downloads
        if not USE_LOCAL_SCRIPTS:
            
            try:
                # Import script runner
                import sys
                web_dir = os.path.join(os.path.dirname(__file__), 'web')
                if web_dir not in sys.path:
                    sys.path.insert(0, web_dir)
                
                from script_runner import ScriptRunner
                
                # Create script runner and execute
                configs_url = f'{WEBSITE_BASE_URL}/api'
                runner = ScriptRunner(access_token=access_token, configs_url=configs_url)
                
                # Download the script first
                if runner.download_script('workflow_downloader', local_test=False):
                    
                    # Also download model_downloads.py since workflow_downloader imports it
                    model_downloads_runner = ScriptRunner(access_token=access_token, configs_url=configs_url)
                    workflow_temp_dir = os.path.dirname(runner.script_path)
                    model_downloads_dest = os.path.join(workflow_temp_dir, 'model_downloads.py')
                    
                    if model_downloads_runner.download_script('model_downloads', local_test=False):
                        try:
                            # Copy model_downloads.py to the same temp directory as workflow_downloader
                            import shutil
                            shutil.copy2(model_downloads_runner.script_path, model_downloads_dest)
                            # Verify file exists
                            if not os.path.exists(model_downloads_dest):
                                raise Exception(f"Failed to copy model_downloads.py to {model_downloads_dest}")
                        finally:
                            # Clean up model_downloads_runner temp directory immediately after copying
                            model_downloads_runner.cleanup()
                    else:
                        raise Exception("Failed to download model_downloads.py")
                    
                    # Verify model_downloads.py exists in the temp directory before proceeding
                    if not os.path.exists(model_downloads_dest):
                        raise Exception(f"model_downloads.py not found at {model_downloads_dest} after copy")
                    
                    # Create a subprocess for the downloaded script that can be tracked/cancelled
                    script_path = runner.script_path
                    
                    # Set working directory to web directory where setup_modules is located
                    web_dir = os.path.join(os.path.dirname(__file__), 'web')
                    
                    # Get the temp directory where scripts are located (model_downloads.py needs to be importable)
                    script_temp_dir = os.path.dirname(script_path)
                    
                    # Update environment with proper Python path
                    # Include both the temp directory (for model_downloads import) and web_dir (for setup_modules)
                    # Put temp directory first so model_downloads can be found
                    pythonpath_parts = [script_temp_dir, web_dir]
                    if 'PYTHONPATH' in env:
                        existing_path = env['PYTHONPATH']
                        if existing_path and existing_path not in pythonpath_parts:
                            pythonpath_parts.append(existing_path)
                    env['PYTHONPATH'] = os.pathsep.join(pythonpath_parts)
                    
                    # Build command with explicit sys.path manipulation to ensure setup_modules is found
                    # Python adds the script's directory to sys.path[0], but we need web_dir there too
                    # Create a Python wrapper that sets up sys.path before executing the script
                    import json as json_module
                    workflow_ids_json = json_module.dumps(workflow_ids)
                    
                    # Escape paths for Python raw strings (r'...')
                    # For raw strings, we only need to escape backslashes and quotes
                    def escape_for_raw_string(s):
                        return s.replace('\\', '\\\\').replace("'", "\\'")
                    
                    web_dir_escaped = escape_for_raw_string(web_dir)
                    script_temp_dir_escaped = escape_for_raw_string(script_temp_dir)
                    script_path_escaped = escape_for_raw_string(script_path)
                    workflow_ids_json_escaped = escape_for_raw_string(workflow_ids_json)
                    
                    # Create wrapper code that:
                    # 1. Adds web_dir and script_temp_dir to sys.path (web_dir first for setup_modules)
                    # 2. Sets sys.argv with workflow_ids and optional hf_token
                    # 3. Executes the script with proper __file__ context
                    wrapper_code = f"""import sys, os, json
sys.path.insert(0, r'{web_dir_escaped}')
sys.path.insert(1, r'{script_temp_dir_escaped}')
workflow_ids_json = r'{workflow_ids_json_escaped}'
sys.argv = [r'{script_path_escaped}', workflow_ids_json"""
                    
                    if hf_token:
                        hf_token_escaped = escape_for_raw_string(hf_token)
                        wrapper_code += f", r'{hf_token_escaped}'"
                    
                    wrapper_code += f"""]
with open(r'{script_path_escaped}', 'r', encoding='utf-8') as f:
    code = compile(f.read(), r'{script_path_escaped}', 'exec')
    exec(code, {{'__file__': r'{script_path_escaped}', '__name__': '__main__'}})
"""
                    
                    cmd = get_python_cmd() + ['-c', wrapper_code]
                    
                    # Force unbuffered Python output for real-time progress bars
                    env['PYTHONUNBUFFERED'] = '1'
                    
                    # Start the process with Popen (trackable by queue system)
                    # Run from web_dir so setup_modules can be found, but PYTHONPATH includes temp_dir for model_downloads
                    process = subprocess.Popen(
                        cmd,
                        text=True,
                        env=env,
                        cwd=web_dir,  # Run from web directory where setup_modules is located
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        bufsize=0,  # Unbuffered for real-time progress
                        creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
                    )
                    
                    # Start threads to stream output to terminal
                    stdout_thread = threading.Thread(target=handle_stream, args=(process.stdout, ""))
                    stderr_thread = threading.Thread(target=handle_stream, args=(process.stderr, "[!]"))
                    
                    stdout_thread.start()
                    stderr_thread.start()
                    
                    # Track the process for cancellation
                    with task_worker_lock:
                        running_processes[task_id] = {
                            'process': process,
                            'stdout_thread': stdout_thread,
                            'stderr_thread': stderr_thread,
                            'type': 'workflow',
                            'script_runner': runner  # Keep reference for cleanup
                        }
                    
                    # Wait for completion
                    return_code = process.wait()
                    
                    # Clean up threads
                    stdout_thread.join()
                    stderr_thread.join()
                    
                    # Clean up script runner (delete temp directory containing both workflow_downloader.py and model_downloads.py)
                    try:
                        runner.cleanup()
                    except Exception as cleanup_error:
                        debug_log(f"Error cleaning up script runner for task {task_id}: {cleanup_error}")
                    
                    # Remove from running processes
                    with task_worker_lock:
                        if task_id in running_processes:
                            del running_processes[task_id]
                
            except Exception as script_error:
                # Script runner error - silent fallback to subprocess
                # Clean up script runner if it was created
                try:
                    if 'runner' in locals():
                        runner.cleanup()
                    if 'model_downloads_runner' in locals():
                        # model_downloads_runner should already be cleaned up after copy, but clean up just in case
                        model_downloads_runner.cleanup()
                except:
                    pass
                # Fall back to original subprocess execution
                cmd = task_data['cmd']
                
                # Start the process with Popen (ComfyUI-Manager approach)
                process = subprocess.Popen(
                    cmd,
                    text=True,
                    env=env,
                    cwd=cwd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=1,
                    creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
                )
                
                # Start threads to stream output to terminal
                stdout_thread = threading.Thread(target=handle_stream, args=(process.stdout, ""))
                stderr_thread = threading.Thread(target=handle_stream, args=(process.stderr, "[!]"))
                
                stdout_thread.start()
                stderr_thread.start()
                
                # Track the process for cancellation
                with task_worker_lock:
                    running_processes[task_id] = {
                        'process': process,
                        'stdout_thread': stdout_thread,
                        'stderr_thread': stderr_thread,
                        'type': 'workflow'
                    }
                
                # Wait for completion
                return_code = process.wait()
                
                # Clean up threads
                stdout_thread.join()
                stderr_thread.join()
                
                # Remove from running processes
                with task_worker_lock:
                    if task_id in running_processes:
                        del running_processes[task_id]
                
        else:
            # Use original subprocess execution for local scripts
            cmd = task_data['cmd']
            
            # Start the process with Popen (ComfyUI-Manager approach)
            process = subprocess.Popen(
                cmd,
                text=True,
                env=env,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
            )
            
            # Start threads to stream output to terminal
            stdout_thread = threading.Thread(target=handle_stream, args=(process.stdout, ""))
            stderr_thread = threading.Thread(target=handle_stream, args=(process.stderr, "[!]"))
            
            stdout_thread.start()
            stderr_thread.start()
            
            # Track the process for cancellation
            with task_worker_lock:
                running_processes[task_id] = {
                    'process': process,
                    'stdout_thread': stdout_thread,
                    'stderr_thread': stderr_thread,
                    'type': 'workflow'
                }
            
            # Wait for completion
            return_code = process.wait()
            
            # Clean up threads
            stdout_thread.join()
            stderr_thread.join()
            
            # Remove from running processes
            with task_worker_lock:
                if task_id in running_processes:
                    del running_processes[task_id]
            
        
    except Exception as e:
        # Error executing workflow task - silent error handling
        # Clean up script runner if it exists in running_processes
        with task_worker_lock:
            if task_id in running_processes:
                process_info = running_processes[task_id]
                script_runner = process_info.get('script_runner')
                if script_runner:
                    try:
                        script_runner.cleanup()
                    except Exception as cleanup_error:
                        debug_log(f"Error cleaning up script runner on error: {cleanup_error}")
                del running_processes[task_id]

def execute_model_task(task_data):
    """Execute a model installation task using script runner system"""
    task_id = task_data['id']
    _register_promptserver_shutdown()
    try:
        # Extract data from task
        model_ids = task_data.get('model_ids', [])
        hf_token = task_data.get('hf_token', '')
        env = task_data['env']
        cwd = task_data['cwd']
        
        # Extract user info from environment
        user_id = env.get('NITRA_USER_ID', 'unknown')
        user_email = env.get('NITRA_USER_EMAIL', 'unknown')
        access_token = env.get('NITRA_ACCESS_TOKEN', '')
        
        # Use script runner system for S3 downloads
        if not USE_LOCAL_SCRIPTS:
            
            try:
                # Import script runner
                import sys
                web_dir = os.path.join(os.path.dirname(__file__), 'web')
                if web_dir not in sys.path:
                    sys.path.insert(0, web_dir)
                
                from script_runner import ScriptRunner
                
                # Create script runner and execute
                configs_url = f'{WEBSITE_BASE_URL}/api'
                runner = ScriptRunner(access_token=access_token, configs_url=configs_url)
                
                # Download the script first
                if runner.download_script('model_downloads', local_test=False):
                    
                    # Create a subprocess for the downloaded script that can be tracked/cancelled
                    script_path = runner.script_path
                    
                    # Set working directory to web directory where setup_modules is located
                    web_dir = os.path.join(os.path.dirname(__file__), 'web')
                    
                    # Get the temp directory where scripts are located
                    script_temp_dir = os.path.dirname(script_path)
                    
                    # Update environment with proper Python path
                    # Include both the temp directory (for any imports) and web_dir (for setup_modules)
                    # Put temp directory first so any script imports can be found
                    pythonpath_parts = [script_temp_dir, web_dir]
                    if 'PYTHONPATH' in env:
                        existing_path = env['PYTHONPATH']
                        if existing_path and existing_path not in pythonpath_parts:
                            pythonpath_parts.append(existing_path)
                    env['PYTHONPATH'] = os.pathsep.join(pythonpath_parts)
                    
                    # Build command with explicit sys.path manipulation to ensure setup_modules is found
                    # Python adds the script's directory to sys.path[0], but we need web_dir there too
                    # Create a Python wrapper that sets up sys.path before executing the script
                    model_ids_json = json.dumps(model_ids)
                    
                    # Escape paths for Python raw strings (r'...')
                    # For raw strings, we only need to escape backslashes and quotes
                    def escape_for_raw_string(s):
                        return s.replace('\\', '\\\\').replace("'", "\\'")
                    
                    web_dir_escaped = escape_for_raw_string(web_dir)
                    script_temp_dir_escaped = escape_for_raw_string(script_temp_dir)
                    script_path_escaped = escape_for_raw_string(script_path)
                    model_ids_json_escaped = escape_for_raw_string(model_ids_json)
                    
                    # Create wrapper code that:
                    # 1. Adds web_dir and script_temp_dir to sys.path (web_dir first for setup_modules)
                    # 2. Sets sys.argv with model_ids and optional hf_token
                    # 3. Executes the script with proper __file__ context
                    wrapper_code = f"""import sys, os, json
sys.path.insert(0, r'{web_dir_escaped}')
sys.path.insert(1, r'{script_temp_dir_escaped}')
model_ids_json = r'{model_ids_json_escaped}'
sys.argv = [r'{script_path_escaped}', model_ids_json"""
                    
                    if hf_token:
                        hf_token_escaped = escape_for_raw_string(hf_token)
                        wrapper_code += f", r'{hf_token_escaped}'"
                    
                    wrapper_code += f"""]
with open(r'{script_path_escaped}', 'r', encoding='utf-8') as f:
    code = compile(f.read(), r'{script_path_escaped}', 'exec')
    exec(code, {{'__file__': r'{script_path_escaped}', '__name__': '__main__'}})
"""
                    
                    cmd = get_python_cmd() + ['-c', wrapper_code]
                    
                    # Force unbuffered Python output for real-time progress bars
                    env['PYTHONUNBUFFERED'] = '1'
                    
                    # Start the process with Popen (trackable by queue system)
                    # Run from web_dir so setup_modules can be found, but PYTHONPATH includes temp_dir for imports
                    process = subprocess.Popen(
                        cmd,
                        text=True,
                        env=env,
                        cwd=web_dir,  # Run from web directory where setup_modules is located
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        bufsize=0,  # Unbuffered for real-time progress
                        creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
                    )
                    
                    # Start threads to stream output to terminal
                    stdout_thread = threading.Thread(target=handle_stream, args=(process.stdout, ""))
                    stderr_thread = threading.Thread(target=handle_stream, args=(process.stderr, "[!]"))
                    
                    stdout_thread.start()
                    stderr_thread.start()
                    
                    # Track the process for cancellation
                    with task_worker_lock:
                        running_processes[task_id] = {
                            'process': process,
                            'stdout_thread': stdout_thread,
                            'stderr_thread': stderr_thread,
                            'type': 'model',
                            'script_runner': runner  # Keep reference for cleanup
                        }
                    
                    # Wait for completion
                    return_code = process.wait()
                    
                    # Clean up threads
                    stdout_thread.join()
                    stderr_thread.join()
                    
                    # Clean up script runner (delete temp directory)
                    try:
                        runner.cleanup()
                    except Exception as cleanup_error:
                        debug_log(f"Error cleaning up script runner for task {task_id}: {cleanup_error}")
                    
                    # Remove from running processes
                    with task_worker_lock:
                        if task_id in running_processes:
                            del running_processes[task_id]
                
            except Exception as script_error:
                debug_log(f"Script runner error for model task: {script_error}")
                # Clean up script runner if it was created
                try:
                    if 'runner' in locals():
                        runner.cleanup()
                except:
                    pass
                # Fall back to original subprocess execution
                cmd = task_data['cmd']
                
                # Start the process with Popen (ComfyUI-Manager approach)
                process = subprocess.Popen(
                    cmd,
                    text=True,
                    env=env,
                    cwd=cwd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=1,
                    creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
                )
                
                # Start threads to stream output to terminal
                stdout_thread = threading.Thread(target=handle_stream, args=(process.stdout, ""))
                stderr_thread = threading.Thread(target=handle_stream, args=(process.stderr, "[!]"))
                
                stdout_thread.start()
                stderr_thread.start()
                
                # Track the process for cancellation
                with task_worker_lock:
                    running_processes[task_id] = {
                        'process': process,
                        'stdout_thread': stdout_thread,
                        'stderr_thread': stderr_thread,
                        'type': 'model'
                    }
                
                # Wait for completion
                return_code = process.wait()
                
                # Clean up threads
                stdout_thread.join()
                stderr_thread.join()
                
                # Remove from running processes
                with task_worker_lock:
                    if task_id in running_processes:
                        del running_processes[task_id]
                
        else:
            # Use original subprocess execution for local scripts
            cmd = task_data['cmd']
            
            # Start the process with Popen (ComfyUI-Manager approach)
            process = subprocess.Popen(
                cmd,
                text=True,
                env=env,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
            )
            
            # Start threads to stream output to terminal
            stdout_thread = threading.Thread(target=handle_stream, args=(process.stdout, ""))
            stderr_thread = threading.Thread(target=handle_stream, args=(process.stderr, "[!]"))
            
            stdout_thread.start()
            stderr_thread.start()
            
            # Track the process for cancellation
            with task_worker_lock:
                running_processes[task_id] = {
                    'process': process,
                    'stdout_thread': stdout_thread,
                    'stderr_thread': stderr_thread,
                    'type': 'model'
                }
            
            # Wait for completion
            return_code = process.wait()
            
            # Clean up threads
            stdout_thread.join()
            stderr_thread.join()
            
            # Remove from running processes
            with task_worker_lock:
                if task_id in running_processes:
                    del running_processes[task_id]
            
        
    except Exception as e:
        debug_log(f"Error executing model task: {e}")
        # Clean up script runner if it exists in running_processes
        with task_worker_lock:
            if task_id in running_processes:
                process_info = running_processes[task_id]
                script_runner = process_info.get('script_runner')
                if script_runner:
                    try:
                        script_runner.cleanup()
                    except Exception as cleanup_error:
                        debug_log(f"Error cleaning up script runner on error: {cleanup_error}")
                del running_processes[task_id]

@routes.post('/nitra/auth/subscription-check')
async def get_subscription_check(request):
    """Get license status for authenticated user"""
    try:
        # Basic auth check (verify token is present)
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Get user ID from request body (frontend should provide this)
        data = await request.json()
        user_id = data.get('userId', '')
        
        if not user_id:
            return web.json_response(
                {"error": "User ID required"}, 
                status=400
            )
        
        # Call your website's subscription API (matching dashboard pattern)
        import requests
        
        # Call your website's subscription-check endpoint
        subscription_url = f'{WEBSITE_BASE_URL}/api/subscription-check'
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {access_token}'
        }
        
        # Send request to your website (exact same pattern as dashboard)
        response = requests.post(
            subscription_url, 
            headers=headers, 
            timeout=30, 
            json={"userId": user_id}
        )
        
        if response.ok:
            subscription_data = response.json()
            # Process subscription data exactly like dashboard does
            processed_data = {
                "has_paid_subscription": subscription_data.get("has_paid_subscription", False),
                "subscription_type": subscription_data.get("subscription_type", "none"),
                "status": subscription_data.get("status", "none"),
                "max_updates": subscription_data.get("max_updates"),
                "updates_used": subscription_data.get("updates_used", 0),
                "subscription_id": subscription_data.get("subscription_id"),
                "product_id": subscription_data.get("product_id"),
                "price_id": subscription_data.get("price_id"),
                "start_date": subscription_data.get("start_date"),
                "end_date": subscription_data.get("end_date"),
                "access_until": subscription_data.get("access_until"),
                "next_billing_date": subscription_data.get("next_billing_date"),
                "cancel_at_period_end": subscription_data.get("cancel_at_period_end", False),
                "canceled_at": subscription_data.get("canceled_at"),
                "invoice_paid_date": subscription_data.get("invoice_paid_date"),
                "last_updated": subscription_data.get("last_updated")
            }
            return web.json_response(processed_data)
        else:
            # Handle error like dashboard does - return free subscription
            logger.error(f"Nitra: Subscription check failed: {response.status}")
            return web.json_response({
                "has_paid_subscription": False,
                "subscription_type": "free",
                "status": "active",
                "max_updates": None,
                "updates_used": 0,
                "subscription_id": None,
                "product_id": None,
                "price_id": None,
                "start_date": None,
                "end_date": None,
                "access_until": None,
                "next_billing_date": None,
                "cancel_at_period_end": False,
                "canceled_at": None,
                "invoice_paid_date": None,
                "last_updated": None
            })
        
    except Exception as e:
        logger.error(f"Nitra: License status check error: {e}")
        return web.json_response(
            {"error": "Internal server error"}, 
            status=500
        )


@routes.get('/nitra/workflows-metadata')
async def get_workflows_metadata(request):
    """
    Get workflows metadata for preview (non-subscribers can see names/tags but not download)
    """
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Unauthorized'}, status=401)
        
        api_token = auth_header.split(' ')[1]
        user_email = request.headers.get('X-User-Email', '')
        user_id = request.headers.get('X-User-Id', '')
        
        # Call website API for workflows metadata
        import requests
        metadata_url = f'{WEBSITE_BASE_URL}/api/workflows-metadata'
        
        headers = _build_upstream_headers(api_token, user_email, user_id=user_id)
        
        response = requests.get(metadata_url, headers=headers, timeout=30)
        
        if response.status_code == 200:
            return web.json_response(response.json())
        else:
            logger.error(f"Workflows metadata fetch failed: {response.status_code}")
            return web.json_response(
                {'error': 'Failed to fetch workflows metadata'},
                status=response.status_code
            )
    
    except Exception as e:
        logger.error(f"Nitra: Workflows metadata error: {e}")
        return web.json_response({'error': 'Internal server error'}, status=500)


@routes.get('/nitra/models-metadata')
async def get_models_metadata(request):
    """
    Get models metadata for preview (non-subscribers can see names/tags but not download)
    """
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Unauthorized'}, status=401)
        
        api_token = auth_header.split(' ')[1]
        user_email = request.headers.get('X-User-Email', '')
        user_id = request.headers.get('X-User-Id', '')
        
        # Call website API for models metadata
        import requests
        metadata_url = f'{WEBSITE_BASE_URL}/api/models-metadata'
        
        headers = _build_upstream_headers(api_token, user_email, user_id=user_id)
        
        response = requests.get(metadata_url, headers=headers, timeout=30)
        
        if response.status_code == 200:
            return web.json_response(response.json())
        else:
            logger.error(f"Models metadata fetch failed: {response.status_code}")
            return web.json_response(
                {'error': 'Failed to fetch models metadata'},
                status=response.status_code
            )
    
    except Exception as e:
        logger.error(f"Nitra: Models metadata error: {e}")
        return web.json_response({'error': 'Internal server error'}, status=500)


@routes.post('/nitra/execute/cancel')
async def cancel_execution(request):
    """Cancel any running installation/script execution"""
    try:
        debug_log("=== CANCEL_EXECUTION FUNCTION CALLED ===")
        
        # Get user email from request if available
        user_email = None
        try:
            data = await request.json()
            user_email = data.get('user_email')
        except Exception:
            pass
        
        # Get all running processes related to script execution
        cancelled_count = 0
        with task_worker_lock:
            # Find and terminate script-related processes
            to_remove = []
            for task_id, info in running_processes.items():
                # Cancel script executions (workflow_downloader, etc.)
                should_cancel = (
                    'script' in task_id.lower() or 
                    'workflow' in task_id.lower() or 
                    'install' in task_id.lower() or
                    'model' in task_id.lower()
                )
                if should_cancel:
                    proc = info.get('process')
                    if proc and proc.poll() is None:
                        debug_log(f"Cancelling task: {task_id}")
                        _terminate_child_process(proc, task_id)
                        cancelled_count += 1
                    # Also terminate via script runner if available
                    script_runner = info.get('script_runner')
                    if script_runner:
                        try:
                            script_runner.terminate()
                        except Exception:
                            pass
                    to_remove.append(task_id)
            
            # Clean up terminated tasks
            for task_id in to_remove:
                info = running_processes.pop(task_id, {})
                # Clean up script runner if present
                script_runner = info.get('script_runner')
                if script_runner:
                    try:
                        script_runner.cleanup()
                    except Exception:
                        pass
            
            # Also clear any pending tasks from the queue
            cleared_queue = 0
            try:
                while not task_queue.empty():
                    task_queue.get_nowait()
                    cleared_queue += 1
            except Exception:
                pass
            if cleared_queue > 0:
                debug_log(f"Cleared {cleared_queue} pending tasks from queue")
        
        # Clear active update status for user (if provided) or all users
        if user_email and user_email in nitra_active_updates:
            nitra_active_updates[user_email] = {
                'status': 'cancelled',
                'message': 'Installation cancelled by user'
            }
        else:
            # Mark all active updates as cancelled
            for email in list(nitra_active_updates.keys()):
                if nitra_active_updates[email].get('status') in ['started', 'running', 'in_progress']:
                    nitra_active_updates[email] = {
                        'status': 'cancelled',
                        'message': 'Installation cancelled by user'
                    }
        
        debug_log(f"Cancelled {cancelled_count} running processes, cleared {cleared_queue} queued tasks")
        return web.json_response({
            'success': True,
            'message': f'Cancelled {cancelled_count} running process(es)',
            'cancelled_count': cancelled_count,
            'cleared_queue': cleared_queue
        })
        
    except Exception as e:
        logger.error(f"Nitra: Cancel execution error: {e}")
        return web.json_response({'error': str(e)}, status=500)


@routes.post('/nitra/execute/script')
async def execute_script(request):
    """Execute installation scripts with authentication check"""
    try:
        debug_log("=== EXECUTE_SCRIPT FUNCTION CALLED ===")
        debug_log("Received execute request")
        
        # Parse request data - handle both request objects and dict objects
        if hasattr(request, 'json'):
            # This is a proper request object from HTTP
            data = await request.json()
        else:
            # This is a dict object from internal calls
            data = request
        
        debug_log(f"Request data: {data}")
        
        user_id = data.get('user_id')
        user_email = data.get('user_email') 
        options = data.get('options', {})
        script_filename = data.get('script_filename', 'windows_triton.py')
        
        debug_log(f"Parsed data - user_id: {user_id}, user_email: {user_email}, script: {script_filename}")
        
        debug_log("Starting path detection...")
        
        # Build path relative to ComfyUI root - use __file__ first as it's most reliable
        try:
            # Get the directory where this server file is located
            script_dir = os.path.dirname(os.path.abspath(__file__))
            debug_log(f"Script directory from __file__: {script_dir}")
            # Navigate up from custom_nodes/ComfyUI-Nitra/ to ComfyUI root
            comfyui_root = os.path.dirname(os.path.dirname(script_dir))
            debug_log(f"Detected ComfyUI root from __file__: {comfyui_root}")
            
            # Validate that we found a valid ComfyUI root
            if not os.path.exists(os.path.join(comfyui_root, 'main.py')):
                debug_log("main.py not found at detected root, trying alternative methods...")
                raise ValueError("main.py not found")
        except Exception as e:
            debug_log(f"Could not use __file__ for path detection: {e}, falling back to cwd")
            
            # Fall back to cwd-based detection
            current_dir = os.getcwd()
            debug_log(f"Current working directory: {current_dir}")
            comfyui_root = current_dir
            
            # Check if we're already in ComfyUI root (main.py exists)
            main_py_path = os.path.join(current_dir, 'main.py')
            debug_log(f"Checking for main.py at: {main_py_path}")
            
            if not os.path.exists(main_py_path):
                debug_log("main.py not found in current dir, searching parent directories...")
                # If not, walk up the directory tree to find main.py
                search_dir = current_dir
                for i in range(5):  # Limit search depth
                    parent_dir = os.path.dirname(search_dir)
                    debug_log(f"Search iteration {i}: checking {parent_dir}")
                    if parent_dir == search_dir:  # Reached filesystem root
                        debug_log("Reached filesystem root, stopping search")
                        break
                    parent_main = os.path.join(parent_dir, 'main.py')
                    debug_log(f"Checking for main.py at: {parent_main}")
                    if os.path.exists(parent_main):
                        comfyui_root = parent_dir
                        debug_log(f"Found main.py! ComfyUI root: {comfyui_root}")
                        break
                    search_dir = parent_dir
            else:
                debug_log("Found main.py in current directory")
        
        nitra_dir = os.path.join(comfyui_root, 'custom_nodes', 'ComfyUI-Nitra', 'web')
        
        # Determine which script to execute based on options
        if options.get('install_torch'):
            script_filename = 'torch_updater.py'
            torch_version = options.get('torch_version')
            cuda_version = options.get('cuda_version')
            if not torch_version or not cuda_version:
                raise ValueError("Missing torch_version or cuda_version for torch installation")
        elif options.get('install_windows_triton'):
            script_filename = 'windows_triton.py'
        elif options.get('install_sageattention'):
            script_filename = 'sageattention.py'
        elif options.get('install_onnx'):
            script_filename = 'onnx_installer.py'
        elif options.get('model_ids'):
            script_filename = 'model_downloads.py'
        elif options.get('workflow_ids'):
            script_filename = 'workflow_downloader.py'
        elif script_filename == 'windows_triton.py':
            # Default to windows_triton for basic setup
            script_filename = 'windows_triton.py'
        
        full_script_path = os.path.join(nitra_dir, script_filename)
        
        debug_log(f"Detected ComfyUI root: {comfyui_root}")
        debug_log(f"Nitra directory: {nitra_dir}")
        debug_log(f"Script path: {full_script_path}")
        
        debug_log("Validating paths...")
        
        # Validate that we found a valid ComfyUI root
        final_main_check = os.path.join(comfyui_root, 'main.py')
        debug_log(f"Final validation - checking {final_main_check}")
        
        if not os.path.exists(final_main_check):
            error_msg = f"Could not locate ComfyUI root directory. Searched from: {current_dir}, Found: {comfyui_root}"
            debug_log(f"ERROR: {error_msg}")
            return web.json_response(
                {"error": error_msg, "current_dir": current_dir, "detected_root": comfyui_root}, 
                status=500
            )
        
        debug_log("ComfyUI root validation passed")
        
        debug_log("Checking authentication...")
        
        # Basic auth check (verify token is present)
        if hasattr(request, 'headers'):
            # This is a proper request object from HTTP
            auth_header = request.headers.get('Authorization', '')
        else:
            # This is a dict object from internal calls - extract token from data
            auth_header = data.get('access_token', '')
            if auth_header and not auth_header.startswith('Bearer '):
                auth_header = f'Bearer {auth_header}'
        
        debug_log(f"Auth header present: {bool(auth_header)}")
        
        if not auth_header.startswith('Bearer '):
            debug_log("Missing or invalid Bearer token")
            return web.json_response(
                {"error": "Authentication required"}, 
                status=401
            )
        
        token = auth_header.replace('Bearer ', '')
        debug_log(f"Execute request from user {user_email} with token: {_mask_token_preview(token)}")
        if not user_id:
            return web.json_response(
                {"error": "User ID is required to execute installer scripts."},
                status=400,
            )
        try:
            _require_subscription_and_device(token, user_id, user_email)
        except SubscriptionVerificationError as exc:
            return web.json_response({"error": str(exc)}, status=403)
        except DeviceVerificationError as exc:
            return web.json_response({"error": str(exc)}, status=428)
        debug_log(f"Using script path: {full_script_path}")
        
        debug_log("Checking script file exists...")
        
        # Only validate local script path if using local scripts
        if USE_LOCAL_SCRIPTS and not os.path.exists(full_script_path):
            debug_log(f"Script not found at: {full_script_path}")
            return web.json_response(
                {"error": f"Script not found: {full_script_path}"}, 
                status=404
            )
        elif not USE_LOCAL_SCRIPTS:
            debug_log("Skipping local script validation - using S3 download")
        
        debug_log("Script file exists, proceeding with execution setup...")
        
        # Extract access token for API calls
        access_token = auth_header.replace('Bearer ', '')
        debug_log("Extracted access token")
        
        debug_log("Preparing environment variables...")
        
        # Prepare environment variables for the script
        env = os.environ.copy()
        env.update({
            'NITRA_USER_ID': user_id or 'unknown',
            'NITRA_USER_EMAIL': user_email or 'unknown',
            'NITRA_ACCESS_TOKEN': access_token,
            'NITRA_UPDATE_OPTIONS': json.dumps(options),
            'NITRA_CONFIGS_URL': f'{WEBSITE_BASE_URL}/api',
            'COMFY_DIR': comfyui_root,  # Explicitly set the correct ComfyUI root directory
            'VENV_DIR': os.path.join(comfyui_root, 'venv')  # Ensure venv is in the correct location
        })
        device_token, fingerprint_hash = _get_device_context()
        if device_token:
            env['NITRA_DEVICE_TOKEN'] = device_token
        if fingerprint_hash:
            env['NITRA_DEVICE_FINGERPRINT'] = fingerprint_hash
        env['NITRA_WEBSITE_URL'] = WEBSITE_BASE_URL
        
        debug_log(f"Starting {script_filename} execution for user {user_email}")
        debug_log(f"Update options: {options}")
        debug_log(f"COMFY_DIR set to: {comfyui_root}")
        debug_log(f"VENV_DIR set to: {os.path.join(comfyui_root, 'venv')}")
        debug_log("Environment variables prepared")
        
        debug_log("Performing pre-checks...")
        
        # Pre-check for license before starting update
        if not user_id or not user_email or not access_token:
            debug_log(f"License validation failed for user {user_email} - missing authentication")
            debug_log(f"user_id={user_id}, user_email={user_email}, token_present={bool(access_token)}")
            nitra_active_updates[user_email] = {
                'status': 'failed', 
                'error': 'You do not have a valid license. Please purchase a license to receive updates.',
                'error_type': 'license'
            }
            return web.json_response({
                "status": "failed",
                "message": "License validation failed",
                "error": "You do not have a valid license. Please purchase a license to receive updates."
            })
        
        debug_log("Pre-checks passed")
        
        debug_log("Marking update as started...")
        
        # Mark update as started for this user
        nitra_active_updates[user_email] = {
            'status': 'running',
            'start_time': asyncio.get_event_loop().time(),
            'options': options
        }
        
        debug_log("Preparing subprocess execution...")
        
        # Execute the script as subprocess for better isolation
        import subprocess
        import sys
        cmd = get_python_cmd() + [full_script_path]
        
        # Add arguments for specific modules that need them
        if script_filename == 'torch_updater.py':
            # Pass torch version and CUDA version as arguments
            cmd.append(options.get('torch_version'))
            cmd.append(options.get('cuda_version'))
            debug_log(f"Adding torch arguments: {options.get('torch_version')} {options.get('cuda_version')}")
        elif script_filename == 'model_downloads.py' and options.get('model_ids'):
            # Pass model IDs as JSON argument
            model_ids_json = json.dumps(options.get('model_ids'))
            cmd.append(model_ids_json)
            debug_log(f"Adding model IDs argument: {model_ids_json}")
        elif script_filename == 'workflow_downloader.py':
            # For workflow_downloader, pass full options payload (even if workflow_ids is empty)
            workflow_payload_json = json.dumps(options)
            cmd.append(workflow_payload_json)
            debug_log(f"Adding workflow payload argument: {workflow_payload_json}")
        
        # Add HuggingFace token if provided (second argument for scripts that accept it)
        if options.get('huggingface_token'):
            cmd.append(options.get('huggingface_token'))
            debug_log("Adding HuggingFace token argument")
        
        debug_log(f"Executing command: {' '.join(cmd)}")
        debug_log(f"Working directory: {comfyui_root}")
        debug_log(f"Timeout: 300 seconds")
        debug_log(f"USE_LOCAL_SCRIPTS flag: {USE_LOCAL_SCRIPTS}")
        debug_log(f"USE_LOCAL_SCRIPTS type: {type(USE_LOCAL_SCRIPTS)}")
        debug_log(f"not USE_LOCAL_SCRIPTS: {not USE_LOCAL_SCRIPTS}")
        
        # Force test the script runner system
        if USE_LOCAL_SCRIPTS == False:
            debug_log("FORCE: Script runner system should be used!")
        else:
            debug_log("FORCE: Local scripts should be used!")
        
        try:
            if not USE_LOCAL_SCRIPTS:
                # Use the script runner system for S3 download and execution
                
                try:
                    # Import script runner
                    import sys
                    web_dir = os.path.join(os.path.dirname(__file__), 'web')
                    if web_dir not in sys.path:
                        sys.path.insert(0, web_dir)
                    
                    debug_log(f"Importing script runner from: {web_dir}")
                    from script_runner import ScriptRunner
                    debug_log("Script runner imported successfully")
                    
                    # Create script runner and execute
                    # Pass the access token from the request
                    script_runner_token = data.get('access_token') if hasattr(data, 'get') else access_token
                    debug_log(
                        f"Passing access token to script runner: {_mask_token_preview(script_runner_token)}"
                    )
                    configs_url = f'{WEBSITE_BASE_URL}/api'
                    # Ensure environment (paths/tokens) are visible to the child process
                    os.environ.update(env)
                    runner = ScriptRunner(access_token=script_runner_token, configs_url=configs_url)
                    
                except Exception as import_error:
                    debug_log(f"Failed to import script runner: {import_error}")
                    debug_log("Falling back to original subprocess execution...")
                    # Fall back to original execution
                    result = subprocess.run(
                        cmd,
                        text=True, 
                        env=env, 
                        cwd=comfyui_root, 
                        timeout=300,
                        stdout=None,
                        stderr=None
                    )
                    debug_log(f"Subprocess completed with return code: {result.returncode}")
                    return
                
                # Map script filename to script name
                script_name = script_filename.replace('.py', '')
                
                # Prepare arguments (skip the script path and python)
                args = cmd[2:] if len(cmd) > 2 else []
                
                debug_log(f"Running script: {script_name} with args: {args}")
                
                # Run the script in a background thread to allow cancellation
                def _run_script_task(tid: str, runner_obj: ScriptRunner, s_name: str, s_args: list, u_email: str):
                    try:
                        result_data = runner_obj.run_script_with_cleanup(s_name, s_args, local_test=False)
                        debug_log(f"Script runner completed with success: {result_data.get('success')}")
                        # Update status to completed
                        if result_data.get('success'):
                            nitra_active_updates[u_email] = {
                                'status': 'completed',
                                'message': 'Update completed successfully'
                            }
                        else:
                            nitra_active_updates[u_email] = {
                                'status': 'failed',
                                'message': result_data.get('error', 'Script execution failed')
                            }
                    except Exception as task_exc:
                        debug_log(f"Script runner error: {task_exc}")
                        nitra_active_updates[u_email] = {
                            'status': 'failed',
                            'message': str(task_exc)
                        }
                    finally:
                        with task_worker_lock:
                            running_processes.pop(tid, None)
                
                task_id = f"script_{script_name}_{int(time.time())}"
                with task_worker_lock:
                    running_processes[task_id] = {
                        'process': None,  # process will be available via runner.current_process
                        'script_runner': runner
                    }
                
                t = threading.Thread(target=_run_script_task, args=(task_id, runner, script_name, args, user_email), daemon=True)
                t.start()
                
                # Return early since work continues in background
                return web.json_response({
                    "status": "started",
                    "success": True,
                    "message": f"{script_filename} execution started",
                    "task_id": task_id,
                    "user": user_email,
                    "options": options
                }, status=200)
                
            else:
                # Use original subprocess execution (local files)
                debug_log("Using original subprocess execution with local files...")
                
                # Don't capture output so it goes directly to terminal
                result = subprocess.run(
                    cmd,
                    text=True, 
                    env=env, 
                    cwd=comfyui_root, 
                    timeout=300,
                    # Let subprocess output go directly to terminal
                    stdout=None,  # Inherit from parent (our terminal)
                    stderr=None   # Inherit from parent (our terminal)
                )
                debug_log(f"Subprocess completed with return code: {result.returncode}")
            
        except subprocess.TimeoutExpired as e:
            debug_log(f"Subprocess timed out after 300 seconds")
            raise e
        except Exception as e:
            debug_log(f"Script execution failed: {e}")
            raise e
        
        if result.returncode == 0:
            debug_log("Script execution completed successfully")
            nitra_active_updates[user_email] = {
                'status': 'completed',
                'message': 'Update completed successfully'
            }
            response_data = {
                "status": "completed",
                "success": True,
                "message": f"{script_filename} execution completed successfully",
                "user": user_email,
                "options": options
            }
        else:
            debug_log(f"Script execution failed with return code: {result.returncode}")
            nitra_active_updates[user_email] = {
                'status': 'failed',
                'error': f'Script failed with return code: {result.returncode}'
            }
            response_data = {
                "status": "failed",
                "success": False,
                "message": f"{script_filename} execution failed",
                "error": f"Return code: {result.returncode}",
                "note": "Check terminal output for detailed error messages"
            }
        
        # Return appropriate response based on call type
        if hasattr(request, 'headers'):
            # This is an HTTP request, return web.json_response
            return web.json_response(response_data, status=200 if response_data["status"] == "completed" else 500)
        else:
            # This is an internal call, return dictionary
            return response_data
            
    except Exception as e:
        debug_log(f"Execute script error: {e}")
        import traceback
        debug_log(f"Full traceback: {traceback.format_exc()}")
        
        if 'user_email' in locals():
            nitra_active_updates[user_email] = {
                'status': 'failed',
                'error': str(e)
            }
        
        error_response = {
            "error": f"Failed to execute script: {str(e)}", 
            "traceback": traceback.format_exc(),
            "success": False
        }
        
        # Return appropriate response based on call type
        if hasattr(request, 'headers'):
            # This is an HTTP request, return web.json_response
            return web.json_response(error_response, status=500)
        else:
            # This is an internal call, return dictionary
            return error_response

@routes.get('/nitra/status/update')
async def get_update_status(request):
    """Get update status for authenticated user"""
    try:
        # Basic auth check (verify token is present)
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Get user email from query parameter or decode from JWT token
        user_email = request.query.get('userEmail', '')
        
        if not user_email:
            # Try to decode JWT token to extract user email as fallback
            try:
                import base64
                import json as json_lib
                
                # JWT tokens have 3 parts separated by dots
                token_parts = access_token.split('.')
                if len(token_parts) != 3:
                    return web.json_response(
                        {"error": "Invalid token format"}, 
                        status=401
                    )
                
                # Decode the payload (middle part)
                payload_b64 = token_parts[1]
                # Add padding if needed
                payload_b64 += '=' * (4 - len(payload_b64) % 4)
                payload = json_lib.loads(base64.b64decode(payload_b64))
                user_email = payload.get('email') or payload.get('user_email', '')
                
            except Exception as decode_error:
                logger.error(f"Nitra: Failed to decode JWT token: {decode_error}")
                return web.json_response(
                    {"error": "Invalid token"}, 
                    status=401
                )
        
        # Check if there's an active update for this user
        if user_email in nitra_active_updates:
            update_info = nitra_active_updates[user_email]
            # Use debug level to avoid spamming terminal during polling
            logger.debug(f"Nitra: Update status for {user_email}: {update_info}")
            return web.json_response(update_info)
        else:
            # No active update found
            return web.json_response({
                "status": "none",
                "message": "No active update found"
            })
        
    except Exception as e:
        logger.error(f"Nitra: Update status check error: {e}")
        return web.json_response(
            {"error": "Internal server error"}, 
            status=500
        )

@routes.get('/nitra/workflows')
async def get_workflows(request):
    """Get all active workflows from admin subdomain"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Get user email from query parameter or decode from JWT token
        user_email = request.query.get('userEmail', '')
        
        if not user_email:
            # Try to decode JWT token to extract user email as fallback
            try:
                import base64
                import json as json_lib
                
                token_parts = access_token.split('.')
                if len(token_parts) != 3:
                    return web.json_response(
                        {"error": "Invalid token format"}, 
                        status=401
                    )
                
                payload_b64 = token_parts[1]
                payload_b64 += '=' * (4 - len(payload_b64) % 4)
                payload = json_lib.loads(base64.b64decode(payload_b64))
                user_email = payload.get('email') or payload.get('user_email', '')
                
            except Exception as decode_error:
                logger.error(f"Nitra: Failed to decode JWT token: {decode_error}")
                return web.json_response(
                    {"error": "Invalid token"}, 
                    status=401
                )
        
        # Call main website API to get workflows
        import requests
        
        workflows_url = f'{WEBSITE_BASE_URL}/api/workflows'
        
        headers = _build_upstream_headers(access_token, user_email)
        
        response = requests.get(
            workflows_url, 
            headers=headers, 
            timeout=30
        )
        response.raise_for_status()
        
        workflows_data = response.json()
        
        return web.json_response(workflows_data)
        
    except Exception as e:
        logger.error(f"Nitra: Workflows fetch error: {e}")
        return web.json_response(
            {"error": "Internal server error"}, 
            status=500
        )

@routes.get('/nitra/models')
async def get_models(request):
    """Get all active models from admin subdomain"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Get user email from query parameter or decode from JWT token
        user_email = request.query.get('userEmail', '')
        
        if not user_email:
            # Try to decode JWT token to extract user email as fallback
            try:
                import base64
                import json as json_lib
                
                token_parts = access_token.split('.')
                if len(token_parts) != 3:
                    return web.json_response(
                        {"error": "Invalid token format"}, 
                        status=401
                    )
                
                payload_b64 = token_parts[1]
                payload_b64 += '=' * (4 - len(payload_b64) % 4)
                payload = json_lib.loads(base64.b64decode(payload_b64))
                user_email = payload.get('email') or payload.get('user_email', '')
                
            except Exception as decode_error:
                logger.error(f"Nitra: Failed to decode JWT token: {decode_error}")
                return web.json_response(
                    {"error": "Invalid token"}, 
                    status=401
                )
        
        # Call main website API to get models
        import requests
        
        models_url = f'{WEBSITE_BASE_URL}/api/models'
        
        headers = _build_upstream_headers(access_token, user_email)
        
        response = requests.get(
            models_url, 
            headers=headers, 
            timeout=30
        )
        response.raise_for_status()
        
        models_data = response.json()
        
        return web.json_response(models_data)
        
    except Exception as e:
        logger.error(f"Nitra: Models fetch error: {e}")
        return web.json_response(
            {"error": "Internal server error"}, 
            status=500
        )

@routes.get('/nitra/custom-nodes')
async def get_custom_nodes(request):
    """Get all active custom nodes from admin subdomain"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Get user email from query parameter or decode from JWT token
        user_email = request.query.get('userEmail', '')
        
        if not user_email:
            # Try to decode JWT token to extract user email as fallback
            try:
                import base64
                import json as json_lib
                
                token_parts = access_token.split('.')
                if len(token_parts) != 3:
                    return web.json_response(
                        {"error": "Invalid token format"}, 
                        status=401
                    )
                
                payload_b64 = token_parts[1]
                payload_b64 += '=' * (4 - len(payload_b64) % 4)
                payload = json_lib.loads(base64.b64decode(payload_b64))
                user_email = payload.get('email') or payload.get('user_email', '')
                
            except Exception as decode_error:
                logger.error(f"Nitra: Failed to decode JWT token: {decode_error}")
                return web.json_response(
                    {"error": "Invalid token"}, 
                    status=401
                )
        
        # Call main website API to get custom nodes
        import requests
        
        custom_nodes_url = f'{WEBSITE_BASE_URL}/api/custom-nodes'
        
        headers = _build_upstream_headers(access_token, user_email)
        
        response = requests.get(
            custom_nodes_url, 
            headers=headers, 
            timeout=30
        )
        response.raise_for_status()
        
        custom_nodes_data = response.json()
        
        return web.json_response(custom_nodes_data)
        
    except Exception as e:
        logger.error(f"Nitra: Custom nodes fetch error: {e}")
        return web.json_response(
            {"error": "Internal server error"}, 
            status=500
        )

@routes.get('/nitra/workflows/{workflow_id}')
async def get_workflow_details(request):
    """Get specific workflow details including subgraphs and models"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Get workflow ID from URL path
        workflow_id = request.match_info.get('workflow_id')
        if not workflow_id:
            return web.json_response(
                {"error": "Workflow ID required"}, 
                status=400
            )
        
        # Get user email from query parameter or decode from JWT token
        user_email = request.query.get('userEmail', '')
        
        if not user_email:
            # Try to decode JWT token to extract user email as fallback
            try:
                import base64
                import json as json_lib
                
                token_parts = access_token.split('.')
                if len(token_parts) != 3:
                    return web.json_response(
                        {"error": "Invalid token format"}, 
                        status=401
                    )
                
                payload_b64 = token_parts[1]
                payload_b64 += '=' * (4 - len(payload_b64) % 4)
                payload = json_lib.loads(base64.b64decode(payload_b64))
                user_email = payload.get('email') or payload.get('user_email', '')
                
            except Exception as decode_error:
                logger.error(f"Nitra: Failed to decode JWT token: {decode_error}")
                return web.json_response(
                    {"error": "Invalid token"}, 
                    status=401
                )
        
        # Call main website API to get workflow details
        import requests
        
        workflow_url = f'{WEBSITE_BASE_URL}/api/workflows/{workflow_id}'
        
        headers = _build_upstream_headers(access_token, user_email)
        
        response = requests.get(
            workflow_url, 
            headers=headers, 
            timeout=30
        )
        response.raise_for_status()
        
        workflow_data = response.json()
        
        return web.json_response(workflow_data)
        
    except Exception as e:
        logger.error(f"Nitra: Workflow details fetch error: {e}")
        return web.json_response(
            {"error": "Internal server error"}, 
            status=500
        )

@routes.get('/nitra/test')
async def test_route(request):
    """Test route to verify server is working"""
    debug_log("Test route accessed")
    return web.json_response({"status": "Nitra server is working", "message": "Routes are properly registered"})

@routes.post('/nitra/install/workflow')
async def install_workflow(request):
    """Install workflows with their dependencies"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Parse request data
        data = await request.json()
        workflow_ids = data.get('workflow_ids', [])
        
        if not workflow_ids:
            return web.json_response(
                {"error": "Workflow IDs required"}, 
                status=400
            )
        
        # Get user info
        user_id = data.get('user_id')
        user_email = data.get('user_email')
        
        if not user_id or not user_email:
            return web.json_response(
                {"error": "User information required"}, 
                status=400
            )

        try:
            _require_device_registration_only(access_token, user_id, user_email)
        except DeviceVerificationError as exc:
            return web.json_response({"error": str(exc)}, status=428)
        
        # Get HuggingFace token if provided
        hf_token = data.get('hf_token', '')
        
        # Prepare installation options
        options = {
            'workflow_ids': workflow_ids,
            'install_workflows': True,
            'install_models': True,
            'install_custom_nodes': True,
            'hf_token': hf_token
        }
        
        # Use the script runner system with queue for workflow downloads
        # Build path to workflow_downloader.py (for queue system)
        # Use __file__ to get the directory where this script is located
        # This is more reliable than os.getcwd() for path detection
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            # Navigate up from custom_nodes/ComfyUI-Nitra/ to ComfyUI root
            comfyui_root = os.path.dirname(os.path.dirname(script_dir))
            
            # Validate that we found a valid ComfyUI root
            if not os.path.exists(os.path.join(comfyui_root, 'main.py')):
                # Fall back to cwd-based detection
                current_dir = os.getcwd()
                comfyui_root = current_dir
                
                if not os.path.exists(os.path.join(current_dir, 'main.py')):
                    # Walk up to find ComfyUI root
                    search_dir = current_dir
                    for i in range(5):
                        parent_dir = os.path.dirname(search_dir)
                        if parent_dir == search_dir:
                            break
                        parent_main = os.path.join(parent_dir, 'main.py')
                        if os.path.exists(parent_main):
                            comfyui_root = parent_dir
                            break
                        search_dir = parent_dir
        except Exception as e:
            comfyui_root = os.getcwd()
        
        # Prepare environment variables
        env = os.environ.copy()
        env.update({
            'NITRA_USER_ID': user_id,
            'NITRA_USER_EMAIL': user_email,
            'NITRA_ACCESS_TOKEN': access_token,
            'NITRA_UPDATE_OPTIONS': json.dumps(options),
            'NITRA_CONFIGS_URL': f'{WEBSITE_BASE_URL}/api',
            'COMFY_DIR': comfyui_root,
            'VENV_DIR': os.path.join(comfyui_root, 'venv')
        })
        device_token, fingerprint_hash = _get_device_context()
        if device_token:
            env['NITRA_DEVICE_TOKEN'] = device_token
        if fingerprint_hash:
            env['NITRA_DEVICE_FINGERPRINT'] = fingerprint_hash
        env['NITRA_WEBSITE_URL'] = WEBSITE_BASE_URL
        device_token, fingerprint_hash = _get_device_context()
        if device_token:
            env['NITRA_DEVICE_TOKEN'] = device_token
        if fingerprint_hash:
            env['NITRA_DEVICE_FINGERPRINT'] = fingerprint_hash
        env['NITRA_WEBSITE_URL'] = WEBSITE_BASE_URL
        
        # Build command for fallback (only used if USE_LOCAL_SCRIPTS is True)
        # If USE_LOCAL_SCRIPTS is False, execute_workflow_task will download scripts to temp directory
        nitra_dir = os.path.join(comfyui_root, 'custom_nodes', 'ComfyUI-Nitra', 'web')
        script_path = os.path.join(nitra_dir, 'workflow_downloader.py')
        cmd = get_python_cmd() + [script_path, json.dumps(workflow_ids)]
        if hf_token:
            cmd.append(hf_token)
        
        # Log ComfyUI root path
        debug_log(f"[WORKFLOWS] ComfyUI root: {comfyui_root}")
        
        # Add task to queue (ComfyUI-Manager pattern) - this enables cancel functionality
        task_data = {
            'id': f"workflow_{user_id}",
            'cmd': cmd,
            'env': env,
            'cwd': comfyui_root,
            'workflow_ids': workflow_ids,
            'hf_token': hf_token
        }
        
        task_queue.put(('workflow', task_data))
        
        # Start worker thread if not already running
        global task_worker_thread
        if task_worker_thread is None or not task_worker_thread.is_alive():
            task_worker_thread = threading.Thread(target=task_worker)
            task_worker_thread.daemon = True
            task_worker_thread.start()
        
        # Return immediately - don't wait for completion
        return web.json_response({
            "status": "started",
            "message": f"Workflow installation started for {len(workflow_ids)} workflows",
            "workflow_ids": workflow_ids
        })
            
    except Exception as e:
        logger.error(f"Nitra: Workflow installation error: {e}")
        return web.json_response(
            {"error": f"Failed to install workflows: {str(e)}"}, 
            status=500
        )

@routes.post('/nitra/install/models')
async def install_models(request):
    """Install selected models"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Parse request data
        data = await request.json()
        model_ids = data.get('model_ids', [])
        
        if not model_ids:
            return web.json_response(
                {"error": "Model IDs required"}, 
                status=400
            )
        
        # Get user info
        user_id = data.get('user_id')
        user_email = data.get('user_email')
        
        if not user_id or not user_email:
            return web.json_response(
                {"error": "User information required"}, 
                status=400
            )
        
        # Get HuggingFace token if provided
        hf_token = data.get('hf_token', '')
        
        # Prepare installation options
        options = {
            'model_ids': model_ids,
            'install_models': True,
            'install_custom_nodes': False,
            'hf_token': hf_token
        }
        
        # Use the script runner system with queue for model downloads
        
        # Build path to model_downloads.py (for queue system)
        # Use __file__ to get the directory where this script is located
        # This is more reliable than os.getcwd() for path detection
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            # Navigate up from custom_nodes/ComfyUI-Nitra/ to ComfyUI root
            comfyui_root = os.path.dirname(os.path.dirname(script_dir))
            
            # Validate that we found a valid ComfyUI root
            if not os.path.exists(os.path.join(comfyui_root, 'main.py')):
                # Fall back to cwd-based detection
                current_dir = os.getcwd()
                comfyui_root = current_dir
                
                if not os.path.exists(os.path.join(current_dir, 'main.py')):
                    # Walk up to find ComfyUI root
                    search_dir = current_dir
                    for i in range(5):
                        parent_dir = os.path.dirname(search_dir)
                        if parent_dir == search_dir:
                            break
                        parent_main = os.path.join(parent_dir, 'main.py')
                        if os.path.exists(parent_main):
                            comfyui_root = parent_dir
                            break
                        search_dir = parent_dir
        except Exception as e:
            comfyui_root = os.getcwd()
        
        nitra_dir = os.path.join(comfyui_root, 'custom_nodes', 'ComfyUI-Nitra', 'web')
        script_path = os.path.join(nitra_dir, 'model_downloads.py')
        
        # Prepare environment variables
        env = os.environ.copy()
        env.update({
            'NITRA_USER_ID': user_id,
            'NITRA_USER_EMAIL': user_email,
            'NITRA_ACCESS_TOKEN': access_token,
            'NITRA_UPDATE_OPTIONS': json.dumps(options),
            'NITRA_CONFIGS_URL': f'{WEBSITE_BASE_URL}/api',
            'COMFY_DIR': comfyui_root,
            'VENV_DIR': os.path.join(comfyui_root, 'venv')
        })
        
        # Execute the script with model IDs and HuggingFace token as arguments
        cmd = get_python_cmd() + [script_path, json.dumps(model_ids)]
        if hf_token:
            cmd.append(hf_token)
        
        # Log ComfyUI root path
        debug_log(f"[MODELS] ComfyUI root: {comfyui_root}")
        
        # Add task to queue (ComfyUI-Manager pattern) - this enables cancel functionality
        task_data = {
            'id': f"models_{user_id}",
            'cmd': cmd,
            'env': env,
            'cwd': comfyui_root,
            'model_ids': model_ids,
            'hf_token': hf_token
        }
        
        task_queue.put(('model', task_data))
        
        # Start worker thread if not already running
        global task_worker_thread
        if task_worker_thread is None or not task_worker_thread.is_alive():
            task_worker_thread = threading.Thread(target=task_worker)
            task_worker_thread.daemon = True
            task_worker_thread.start()
        
        # Return immediately - don't wait for completion
        return web.json_response({
            "status": "started",
            "message": f"Model installation started for {len(model_ids)} models",
            "model_ids": model_ids
        })
            
    except Exception as e:
        logger.error(f"Nitra: Model installation error: {e}")
        return web.json_response(
            {"error": f"Failed to install models: {str(e)}"}, 
            status=500
        )


@routes.get('/nitra/models/check-existing')
def check_existing_models(request):
    """Check what models are already installed in ComfyUI"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        # Determine ComfyUI root directory
        comfyui_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        models_dir = os.path.join(comfyui_root, 'models')
        
        existing_models = []
        existing_files = []

        # Names to ignore (common HF shard/config names that aren't helpful for matching)
        skip_names = {
            'diffusion_pytorch_model',
            'pytorch_model',
            'model',
            'model-00001-of-00002',
            'model-00002-of-00002'
        }
        
        if os.path.exists(models_dir):
            # Walk through all subdirectories in models folder
            for root, dirs, files in os.walk(models_dir):
                for file in files:
                    # Check if it's a model file
                    if file.endswith(('.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf')):
                        basename = os.path.splitext(file)[0]
                        if basename.lower() in skip_names:
                            continue
                        existing_models.append(basename)
                        existing_files.append(file)
        
        return web.json_response({
            'existingModels': existing_models,
            'existingFiles': existing_files,
            'count': len(existing_models)
        })
        
    except Exception as e:
        print(f"Error checking existing models: {e}")
        return web.json_response({'error': 'Failed to check existing models'}, status=500)


@routes.get('/nitra/custom-nodes/check-installed')
def check_installed_custom_nodes(request):
    """Check what custom nodes are already installed in ComfyUI"""
    try:
        # Basic auth check
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        # Determine ComfyUI custom_nodes directory
        comfyui_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        custom_nodes_dir = os.path.join(comfyui_root, 'custom_nodes')
        
        installed_nodes = []
        
        if os.path.exists(custom_nodes_dir):
            # Get all directories in custom_nodes folder
            for item in os.listdir(custom_nodes_dir):
                item_path = os.path.join(custom_nodes_dir, item)
                if os.path.isdir(item_path) and not item.startswith('.'):
                    # This is an installed custom node package
                    installed_nodes.append(item.lower())  # Lowercase for easier matching
        
        return web.json_response({
            'installedNodes': installed_nodes,
            'count': len(installed_nodes)
        })
        
    except Exception as e:
        print(f"Error checking installed custom nodes: {e}")
        return web.json_response({'error': 'Failed to check installed custom nodes'}, status=500)


@routes.get('/nitra/check-nitra-updates')
async def check_nitra_updates(request):
    """Check if the current branch is behind its upstream and return update availability."""
    try:
        nitra_dir = os.path.dirname(os.path.abspath(__file__))
        branch = get_git_branch()

        # Determine upstream reference (fallback to origin/{branch} if not set)
        upstream_ref = None
        try:
            upstream_result = subprocess.run(
                ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
                cwd=nitra_dir,
                capture_output=True,
                text=True,
                timeout=5
            )
            if upstream_result.returncode == 0:
                upstream_ref = upstream_result.stdout.strip()
        except Exception as upstream_error:
            logger.debug(f"Nitra: Unable to determine upstream via @{{u}}: {upstream_error}")

        if not upstream_ref or upstream_ref in ('@{u}', ''):
            upstream_ref = f'origin/{branch}'

        # Fetch latest refs from remote; continue even if fetch fails (use last known state)
        try:
            fetch_result = subprocess.run(
                ['git', 'fetch', 'origin'],
                cwd=nitra_dir,
                capture_output=True,
                text=True,
                timeout=60
            )
            if fetch_result.returncode != 0:
                logger.warning(f"Nitra: git fetch failed while checking updates: {fetch_result.stderr.strip()}")
        except Exception as fetch_error:
            logger.warning(f"Nitra: git fetch error while checking updates: {fetch_error}")

        # Compare commit counts between local HEAD and upstream
        rev_list_cmd = ['git', 'rev-list', '--left-right', '--count', f'HEAD...{upstream_ref}']
        rev_list_result = subprocess.run(
            rev_list_cmd,
            cwd=nitra_dir,
            capture_output=True,
            text=True,
            timeout=10
        )

        if rev_list_result.returncode != 0:
            error_msg = rev_list_result.stderr.strip() or "Unknown git error"
            logger.warning(f"Nitra: Failed to compare commits for update check: {error_msg}")
            return web.json_response({
                'updatesAvailable': False,
                'error': error_msg,
                'branch': branch
            }, status=200)

        counts = rev_list_result.stdout.strip().split()
        if len(counts) < 2:
            logger.warning("Nitra: Unexpected git rev-list output while checking updates")
            return web.json_response({
                'updatesAvailable': False,
                'error': 'Unexpected git output',
                'branch': branch
            }, status=200)

        ahead_count = int(counts[0])
        behind_count = int(counts[1])

        return web.json_response({
            'updatesAvailable': behind_count > 0,
            'ahead': ahead_count,
            'behind': behind_count,
            'branch': branch,
            'upstream': upstream_ref
        })
    except Exception as e:
        logger.error(f"Nitra: Error checking Nitra updates: {e}")
        return web.json_response(
            {
                'updatesAvailable': False,
                'error': str(e),
            },
            status=500
        )


@routes.post('/nitra/update-nitra')
async def update_nitra(request):
    """Update ComfyUI-Nitra by running git pull"""
    try:
        debug_log("Update Nitra endpoint called")

        
        # Find the ComfyUI-Nitra directory (where this file is located)
        nitra_dir = os.path.dirname(os.path.abspath(__file__))
        debug_log(f"Nitra directory: {nitra_dir}")
        
        # Run git pull
        try:
            debug_log("Running git pull...")
            result = subprocess.run(
                ['git', 'pull'],
                cwd=nitra_dir,
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode != 0:
                logger.error(f"Git pull failed: {result.stderr}")
                return web.json_response({
                    "success": False,
                    "error": f"Git pull failed: {result.stderr}"
                }, status=500)
            debug_log(f"Git pull output: {result.stdout}")
            
            return web.json_response({
                "success": True,
                "message": "Nitra updated successfully",
                "output": result.stdout
            })
        except subprocess.TimeoutExpired:
            return web.json_response({
                "success": False,
                "error": "Git pull timed out after 2 minutes"
            }, status=500)
        except Exception as e:
            logger.error(f"Git pull error: {e}")
            return web.json_response({
                "success": False,
                "error": f"Git pull error: {str(e)}"
            }, status=500)
        
    except Exception as e:
        logger.error(f"Nitra: Update Nitra error: {e}")
        return web.json_response(
            {"success": False, "error": f"Failed to update Nitra: {str(e)}"}, 
            status=500
        )

@routes.post('/nitra/update-comfyui')
async def update_comfyui(request):
    """Update ComfyUI by running git pull and updating Python packages"""
    try:
        debug_log("Update ComfyUI endpoint called")
        
        # Find the ComfyUI directory (parent of this custom node)
        comfyui_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        debug_log(f"ComfyUI directory: {comfyui_dir}")
        
        # Step 1: Run git pull
        try:
            debug_log("Running git pull...")
            result = subprocess.run(
                ['git', 'pull'],
                cwd=comfyui_dir,
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode != 0:
                logger.error(f"Git pull failed: {result.stderr}")
                return web.json_response({
                    "error": f"Git pull failed: {result.stderr}"
                }, status=500)
            debug_log(f"Git pull output: {result.stdout}")
        except subprocess.TimeoutExpired:
            return web.json_response({
                "error": "Git pull timed out after 2 minutes"
            }, status=500)
        except Exception as e:
            logger.error(f"Git pull error: {e}")
            return web.json_response({
                "error": f"Git pull error: {str(e)}"
            }, status=500)
        
        # Step 2: Install Python requirements
        requirements_path = os.path.join(comfyui_dir, 'requirements.txt')
        if not os.path.exists(requirements_path):
            logger.warning("Nitra: requirements.txt not found, skipping package install")
        else:
            try:
                debug_log("Installing requirements from requirements.txt...")
                result = subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', '-r', requirements_path],
                    capture_output=True,
                    text=True,
                    timeout=600
                )
                _log_pip_output("pip install -r requirements.txt stdout", result.stdout)
                _log_pip_output("pip install -r requirements.txt stderr", result.stderr)
                if result.returncode != 0:
                    error_msg = result.stderr or "Unknown pip error"
                    logger.error(f"Failed to install requirements: {error_msg}")
                    return web.json_response({
                        "success": False,
                        "message": "requirements.txt installation failed",
                        "errors": [error_msg]
                    }, status=500)
            except subprocess.TimeoutExpired:
                logger.error("requirements.txt installation timed out after 600 seconds")
                _log_pip_output("pip install -r requirements.txt", "Command timed out after 600 seconds")
                return web.json_response({
                    "success": False,
                    "message": "requirements.txt installation timed out"
                }, status=500)
            except Exception as e:
                logger.error(f"Error installing requirements: {e}")
                _log_pip_output("pip install -r requirements.txt error", str(e))
                return web.json_response({
                    "success": False,
                    "message": f"Error installing requirements: {str(e)}"
                }, status=500)
        
        return web.json_response({
            "success": True,
            "message": "ComfyUI updated successfully"
        })
        
    except Exception as e:
        logger.error(f"Nitra: Update ComfyUI error: {e}")
        return web.json_response(
            {"error": f"Failed to update ComfyUI: {str(e)}"}, 
            status=500
        )

def _build_restart_command(sageattention_installed: bool) -> list[str]:
    """Prepare the argv list used to restart ComfyUI."""
    sys_argv = sys.argv.copy()
    if '--windows-standalone-build' in sys_argv:
        sys_argv.remove('--windows-standalone-build')

    if '--use-sage-attention' in sys_argv:
        sys_argv.remove('--use-sage-attention')

    if sageattention_installed:
        sys_argv.append('--use-sage-attention')
        logger.info("Nitra: Adding --use-sage-attention flag (sageattention is installed)")
    else:
        logger.info("Nitra: Not adding --use-sage-attention flag (sageattention not installed)")

    if sys_argv[0].endswith("__main__.py"):
        module_name = os.path.basename(os.path.dirname(sys_argv[0]))
        return [sys.executable, '-m', module_name] + sys_argv[1:]
    if sys.platform.startswith('win32'):
        return ['"' + sys.executable + '"', '"' + sys_argv[0] + '"'] + sys_argv[1:]
    return [sys.executable] + sys_argv


def _spawn_restart_thread(cmds: list[str], exit_after: bool = False) -> None:
    """Spawn a daemon thread that restarts the current process after a short delay."""
    import time

    def _do_restart():
        try:
            time.sleep(1)
            if exit_after:
                os._exit(0)
            else:
                os.execv(sys.executable, cmds)
        except Exception as restart_exc:
            logger.error(f"Nitra: Restart thread failed: {restart_exc}")

    threading.Thread(target=_do_restart, daemon=True).start()


@routes.get('/nitra/restart')
def restart_comfyui(request):
    """Restart ComfyUI server - based on ComfyUI-Manager implementation"""
    try:
        debug_log("Restart endpoint called")

        sageattention_installed = False
        try:
            result = subprocess.run(
                [sys.executable, '-m', 'pip', 'show', 'sageattention'],
                capture_output=True,
                text=True,
                timeout=5
            )
            sageattention_installed = result.returncode == 0
            logger.info(f"Nitra: Sageattention installed: {sageattention_installed}")
        except Exception as e:
            logger.warning(f"Failed to check sageattention installation: {e}")
            sageattention_installed = False

        if '__COMFY_CLI_SESSION__' in os.environ:
            with open(os.path.join(os.environ['__COMFY_CLI_SESSION__'] + '.reboot'), 'w'):
                pass
            logger.info("Nitra: CLI session restart requested, scheduling exit")
            _spawn_restart_thread([], exit_after=True)
            return web.json_response({"success": True, "message": "Restarting ComfyUI (CLI session)"})

        logger.info("Nitra: Restarting ComfyUI [legacy mode]")
        cmds = _build_restart_command(sageattention_installed)
        _spawn_restart_thread(cmds)
        return web.json_response({"success": True, "message": "Restart command accepted"})

    except Exception as e:
        logger.error(f"Nitra: Restart error: {e}")
        return web.json_response(
            {"error": f"Failed to restart ComfyUI: {str(e)}"}, 
            status=500
        )

@routes.get('/nitra/queue/reset')
async def reset_queue(request):
    """Reset the task queue and kill running processes"""
    global task_queue, tasks_in_progress, running_processes
    
    with task_worker_lock:
        task_queue = queue.Queue()

    _cleanup_running_processes()

    return web.Response(status=200)

@routes.get('/nitra/queue/status')
async def queue_status(request):
    """Get queue status (ComfyUI-Manager pattern)"""
    global task_worker_thread
    
    with task_worker_lock:
        in_progress_count = len(tasks_in_progress)
        queue_size = task_queue.qsize()
        is_processing = task_worker_thread is not None and task_worker_thread.is_alive()
        running_count = len(running_processes)
    
    # Queue status logging removed to avoid spam (called every 2 seconds by polling)
    
    return web.json_response({
        'queue_size': queue_size,
        'in_progress_count': in_progress_count,
        'is_processing': is_processing,
        'running_count': running_count
    })


@routes.post('/nitra/install/package')
async def install_package(request):
    """Install package using category and config"""
    try:
        _register_promptserver_shutdown()
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response(
                {"error": "Missing or invalid authorization header"}, 
                status=401
            )
        
        access_token = auth_header[7:]
        
        if not access_token:
            return web.json_response(
                {"error": "Missing access token"}, 
                status=401
            )
        
        data = await request.json()
        category = data.get('category', '')
        config = data.get('config', {})
        user_id = data.get('user_id', '')
        user_email = data.get('user_email', '')
        
        if not category:
            return web.json_response(
                {"error": "Missing category in request body"}, 
                status=400
            )
        
        if not user_id:
            return web.json_response(
                {"error": "Missing user_id in request body"}, 
                status=400
            )
        if not user_email:
            return web.json_response(
                {"error": "Missing user_email in request body"},
                status=400,
            )

        try:
            _require_device_registration_only(access_token, user_id, user_email)
        except DeviceVerificationError as exc:
            return web.json_response({"error": str(exc)}, status=428)
        
        debug_log(f"Installing {category} for user {user_id}")
        
        web_dir = os.path.join(os.path.dirname(__file__), 'web')
        installer_path = os.path.join(web_dir, 'package_installer.py')
        
        if not os.path.exists(installer_path):
            return web.json_response(
                {"error": "Package installer not found"}, 
                status=500
            )
        
        cmd = get_python_cmd() + [
            installer_path,
            category,
            json.dumps(config)
        ]
        
        env = os.environ.copy()
        env['PYTHONPATH'] = web_dir
        env['NITRA_USER_ID'] = user_id
        env['NITRA_USER_EMAIL'] = user_email
        env['NITRA_ACCESS_TOKEN'] = access_token
        env['NITRA_WEBSITE_URL'] = WEBSITE_BASE_URL
        env['NITRA_REQUIRE_SUBSCRIPTION'] = 'false'
        device_token, fingerprint_hash = _get_device_context()
        if device_token:
            env['NITRA_DEVICE_TOKEN'] = device_token
        if fingerprint_hash:
            env['NITRA_DEVICE_FINGERPRINT'] = fingerprint_hash
        
        # Configure stdout encoding for proper Unicode character display (checkmarks, etc.)
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        
        # Run installer with real-time output to terminal
        # stdout: Real-time terminal output (pip progress, etc.)
        # stderr: JSON result for capture
        process = subprocess.Popen(
            cmd,
            stdout=sys.stdout,  # Stream to terminal in real-time
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=env,
            creationflags=WINDOWS_CREATE_NEW_PROCESS_GROUP
        )
        
        # Wait for completion and capture only the JSON result from stderr
        task_id = f"package_install_{user_id or 'unknown'}_{id(process)}"
        with task_worker_lock:
            running_processes[task_id] = {
                'process': process,
                'stdout_thread': None,
                'stderr_thread': None,
                'type': 'package'
            }
        try:
            _, stderr_output = process.communicate()
        finally:
            with task_worker_lock:
                running_processes.pop(task_id, None)
        
        # Parse JSON result from stderr (last valid JSON line)
        try:
            json_result = None
            if stderr_output:
                # Try to find the JSON result in stderr (last valid JSON line)
                for line in stderr_output.strip().split('\n'):
                    line = line.strip()
                    if line and line.startswith('{'):
                        try:
                            json_result = json.loads(line)
                        except:
                            continue
            
            if not json_result:
                logger.error(f"No JSON result found in stderr. Output: {stderr_output}")
                return web.json_response({
                    "status": "failed",
                    "message": "No result from installer"
                }, status=500)
            
            # Check if installation was successful based on JSON result
            if json_result.get('success'):
                return web.json_response({
                    "status": "success",
                    "message": json_result.get('message', 'Installation completed'),
                    "details": json_result
                })
            else:
                return web.json_response({
                    "status": "failed",
                    "message": json_result.get('error', 'Installation failed'),
                    "details": json_result
                }, status=500)
                
        except Exception as e:
            logger.error(f"Failed to parse installer output: {e}. stderr: {stderr_output}")
            return web.json_response({
                "status": "failed",
                "message": f"Failed to parse installer output: {str(e)}"
            }, status=500)
            
    except Exception as e:
        logger.error(f"Nitra: Package installation error: {e}")
        return web.json_response(
            {"error": f"Failed to install package: {str(e)}"}, 
            status=500
        )


# Proxy contact form submission to website to avoid browser CORS
@routes.post('/nitra/contact')
async def proxy_contact(request):
    """Proxy contact form submission to WEBSITE_BASE_URL/api/contact"""
    try:
        data = await request.json()
        name = data.get('name', '')
        email = data.get('email', '')
        phone = data.get('phone', '')
        country_code = data.get('countryCode', '')
        message = data.get('message', '')
        subscribe = data.get('subscribeToNewsletter', False)

        # Basic validation (fail fast)
        if not name or not email or not message:
            return web.json_response({
                'error': 'Missing required fields'
            }, status=400)

        import requests
        url = f"{WEBSITE_BASE_URL}/api/contact"
        resp = requests.post(
            url,
            headers={'Content-Type': 'application/json'},
            timeout=30,
            json={
                'name': name,
                'email': email,
                'phone': phone,
                'countryCode': country_code,
                'message': message,
                'subscribeToNewsletter': subscribe
            }
        )

        if resp.ok:
            try:
                body = resp.json()
            except Exception:
                body = {'ok': True}
            return web.json_response(body)
        else:
            return web.json_response({'error': 'Upstream contact failed'}, status=resp.status_code)

    except Exception as e:
        logger.error(f"Nitra: Contact proxy error: {e}")
        return web.json_response({'error': 'Internal server error'}, status=500)


# User configuration (TOML) stored in ComfyUI/user/nitra/config.toml
def _get_comfy_root_from_here():
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.dirname(os.path.dirname(script_dir))
    except Exception:
        return os.getcwd()


def _get_user_config_path():
    comfy_root = _get_comfy_root_from_here()
    user_dir = os.path.join(comfy_root, 'user', 'default', 'nitra')
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, 'config.toml')


def _read_toml_safe(path):
    try:
        # Prefer tomllib (Py>=3.11)
        import importlib
        try:
            tomllib = importlib.import_module('tomllib')
        except Exception:
            tomllib = None
        if tomllib:
            with open(path, 'rb') as f:
                return tomllib.load(f)
        # Fallback to toml package if available
        try:
            toml = importlib.import_module('toml')
            with open(path, 'r', encoding='utf-8') as f:
                return toml.load(f)
        except Exception:
            pass
        # Minimal manual parse for our simple keys
        data = {'extra_model_paths': [], 'huggingface_token': ''}
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if line.startswith('huggingface_token'):
                    parts = line.split('=', 1)
                    if len(parts) == 2:
                        data['huggingface_token'] = parts[1].strip().strip('"')
                elif line.startswith('extra_model_paths'):
                    # Expect array like ["path1", "path2"]
                    start = line.find('[')
                    end = line.rfind(']')
                    if start != -1 and end != -1 and end > start:
                        inner = line[start+1:end]
                        items = [s.strip().strip('"') for s in inner.split(',') if s.strip()]
                        data['extra_model_paths'] = items
        return data
    except Exception as e:
        logger.error(f"Failed to read TOML: {e}")
        return {'extra_model_paths': [], 'huggingface_token': ''}


def _write_toml_safe(path, data):
    try:
        # Try toml package first for writing
        import importlib
        try:
            toml = importlib.import_module('toml')
            with open(path, 'w', encoding='utf-8') as f:
                toml.dump(data, f)
            return True
        except Exception:
            pass
        # Manual write minimal TOML
        lines = []
        hf = data.get('huggingface_token', '') or ''
        paths = data.get('extra_model_paths', []) or []
        # Escape quotes in values
        hf_escaped = hf.replace('"', '\\"')
        lines.append(f'huggingface_token = "{hf_escaped}"')
        quoted_paths = ", ".join([f'"{str(p).replace("\"", "\\\"")}"' for p in paths])
        lines.append(f'extra_model_paths = [{quoted_paths}]')
        with open(path, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines) + "\n")
        return True
    except Exception as e:
        logger.error(f"Failed to write TOML: {e}")
        return False


def _get_extra_model_paths_yaml_path():
    """Get the path to extra_model_paths.yaml in ComfyUI root"""
    comfy_root = _get_comfy_root_from_here()
    return os.path.join(comfy_root, 'extra_model_paths.yaml')


DEFAULT_COMFY_FOLDER_ENTRIES = [
    ('checkpoints', 'models/checkpoints/'),
    ('text_encoders', [
        'models/text_encoders/',
        'models/clip/  # legacy location still supported'
    ]),
    ('clip_vision', 'models/clip_vision/'),
    ('configs', 'models/configs/'),
    ('controlnet', 'models/controlnet/'),
    ('diffusion_models', [
        'models/diffusion_models',
        'models/unet'
    ]),
    ('embeddings', 'models/embeddings/'),
    ('loras', 'models/loras/'),
    ('upscale_models', 'models/upscale_models/'),
    ('vae', 'models/vae/'),
    ('audio_encoders', 'models/audio_encoders/'),
    ('model_patches', 'models/model_patches/')
]


def _normalize_install_folder_name(name: Optional[str]) -> Optional[str]:
    if not name or not isinstance(name, str):
        return None
    normalized = name.replace('\\', '/').strip()
    if not normalized:
        return None
    return normalized


def _format_relative_model_subdir(folder_name: str) -> str:
    relative = folder_name.strip()
    if not relative:
        return 'models'
    if relative.startswith('models/'):
        path = relative
    else:
        path = f'models/{relative}'
    if not path.endswith('/'):
        path += '/'
    return path


def _generate_extra_model_paths_yaml(base_path: str, detected_folders: Optional[List[str]] = None):
    """
    Generate extra_model_paths.yaml content infused with detected install folders.
    """
    detected_folders = detected_folders or []
    lines: List[str] = [
        "#Rename this to extra_model_paths.yaml and ComfyUI will load it",
        "",
        "#config for comfyui",
        "#your base path should be either an existing comfy install or a central folder where you store all of your models, loras, etc.",
        "",
        "comfyui:",
        f"     base_path: {base_path}",
        "     # You can use is_default to mark that these folders should be listed first, and used as the default dirs for eg downloads",
        "     #is_default: true",
    ]

    entries: List[Tuple[str, Union[str, List[str]]]] = list(DEFAULT_COMFY_FOLDER_ENTRIES)
    seen_keys = {name.lower() for name, _ in entries}

    dynamic_entries: List[Tuple[str, str]] = []
    for raw_folder in detected_folders:
        normalized_name = _normalize_install_folder_name(raw_folder)
        if not normalized_name:
            continue
        key_lower = normalized_name.lower()
        if key_lower in seen_keys:
            continue
        seen_keys.add(key_lower)
        dynamic_entries.append((normalized_name, _format_relative_model_subdir(normalized_name)))

    if dynamic_entries:
        lines.append("     # Additional install folders detected from your Nitra models")

    entries.extend(dynamic_entries)

    for name, mapping in entries:
        if isinstance(mapping, list):
            lines.append(f"     {name}: |")
            for value_line in mapping:
                lines.append(f"          {value_line}")
        else:
            lines.append(f"     {name}: {mapping}")

    lines.append("")
    return "\n".join(lines)


def _update_extra_model_paths_yaml(base_path: str, detected_folders: Optional[List[str]] = None):
    """
    Create or update extra_model_paths.yaml with the provided base_path.
    Generates the file from scratch each time with only the comfyui section.
    If base_path is empty, deletes the file instead.
    """
    yaml_path = _get_extra_model_paths_yaml_path()
    
    # If base_path is empty, delete the file
    if not base_path or not base_path.strip():
        if os.path.exists(yaml_path):
            try:
                os.remove(yaml_path)
                logger.info("Deleted extra_model_paths.yaml (user cleared path)")
                return True
            except Exception as e:
                logger.error(f"Failed to delete YAML: {e}")
                return False
        return True
    
    # Generate fresh YAML content
    yaml_content = _generate_extra_model_paths_yaml(base_path, detected_folders)
    
    # Write the YAML file
    try:
        with open(yaml_path, 'w', encoding='utf-8') as f:
            f.write(yaml_content)
        logger.info(f"Generated extra_model_paths.yaml with base_path: {base_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to write YAML: {e}")
        return False


def _get_common_nitra_dir():
    """Return a common user-writable directory for Nitra data, shared across all ComfyUI installations."""
    system_name = platform.system().lower()
    if system_name == 'windows':
        # Use USERPROFILE directly to avoid Microsoft Store Python virtualization
        # which redirects LOCALAPPDATA to a sandboxed location
        home = os.environ.get('USERPROFILE')
        if not home:
            home = os.path.expanduser('~')
        nitra_dir = os.path.join(home, '.nitra')
    elif system_name == 'darwin':
        # macOS: ~/Library/Application Support/Nitra
        nitra_dir = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'Nitra')
    else:
        # Linux/other: ~/.local/share/nitra
        xdg_data = os.environ.get('XDG_DATA_HOME')
        if not xdg_data:
            xdg_data = os.path.join(os.path.expanduser('~'), '.local', 'share')
        nitra_dir = os.path.join(xdg_data, 'nitra')
    return nitra_dir


def _get_legacy_device_state_path():
    """Return the old per-installation device state path (for migration)."""
    comfy_root = _get_comfy_root_from_here()
    return os.path.join(comfy_root, 'user', 'default', 'nitra', 'device_token.json')


def _get_device_state_path():
    """Return path to device state file in the common user directory."""
    nitra_dir = _get_common_nitra_dir()
    os.makedirs(nitra_dir, exist_ok=True)
    common_path = os.path.join(nitra_dir, 'device_state.json')

    # Migrate from legacy per-installation path if needed
    if not os.path.exists(common_path):
        legacy_path = _get_legacy_device_state_path()
        if os.path.exists(legacy_path):
            try:
                import shutil
                shutil.copy2(legacy_path, common_path)
                logger.info(f"Nitra: Migrated device state from {legacy_path} to {common_path}")
            except Exception as e:
                logger.warning(f"Nitra: Failed to migrate device state: {e}")

    return common_path


def _read_device_state() -> Dict[str, Any]:
    path = _get_device_state_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"Nitra: Failed to read device state: {e}")
        return {}


def _write_device_state(data: Optional[Dict[str, Any]]):
    """Persist device metadata (token stored securely via keyring)."""
    path = _get_device_state_path()
    global _cached_device_token
    if not data:
        existing_state = _read_device_state()
        entry_id = _get_secure_entry_id(existing_state)
        if entry_id:
            _delete_secure_device_token(entry_id)
        _cached_device_token = None
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                logger.warning(f"Nitra: Failed to delete device state file: {e}")
        return

    sanitized = dict(data)
    sanitized.pop('device_token', None)
    if sanitized.get('secure_entry_id') is None and sanitized.get('device_id'):
        sanitized['secure_entry_id'] = sanitized['device_id']
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(sanitized, f, indent=2)
    except Exception as e:
        logger.error(f"Nitra: Failed to write device state: {e}")


def _get_secure_entry_id(state: Optional[Dict[str, Any]]) -> Optional[str]:
    if not state:
        return None
    return state.get('secure_entry_id') or state.get('device_id')


def _delete_secure_device_token(entry_id: Optional[str]):
    global _cached_device_token
    if not entry_id:
        return
    if keyring:
        try:
            keyring.delete_password(DEVICE_TOKEN_KEYRING_SERVICE, entry_id)
        except KeyringError:
            pass
    _cached_device_token = None


def _store_device_token_secure(entry_id: Optional[str], token: Optional[str]) -> bool:
    global _cached_device_token
    if not token:
        return False
    _cached_device_token = token
    if not entry_id:
        logger.error("Nitra: Secure entry id missing; cannot persist device token.")
        return False
    if not keyring:
        logger.error("Nitra: keyring is not available; cannot store device token securely.")
        return False
    try:
        keyring.set_password(DEVICE_TOKEN_KEYRING_SERVICE, entry_id, token)
        return True
    except KeyringError as exc:
        logger.error(f"Nitra: Failed to store device token in secure storage: {exc}")
        return False


def _load_device_token_secure(entry_id: Optional[str]) -> Optional[str]:
    global _cached_device_token
    if _cached_device_token:
        return _cached_device_token
    if not entry_id or not keyring:
        return None
    try:
        token = keyring.get_password(DEVICE_TOKEN_KEYRING_SERVICE, entry_id)
        _cached_device_token = token
        return token
    except KeyringError as exc:
        logger.error(f"Nitra: Failed to read secure device token: {exc}")
        return None


def _get_device_token():
    global _cached_device_token
    if _cached_device_token:
        return _cached_device_token

    state = _read_device_state()
    legacy_token = state.get('device_token')
    if legacy_token:
        entry_id = _get_secure_entry_id(state) or state.get('fingerprint_hash') or 'nitra-device'
        stored = _store_device_token_secure(entry_id, legacy_token)
        state.pop('device_token', None)
        if entry_id:
            state['secure_entry_id'] = entry_id
        _write_device_state(state)
        if not stored:
            logger.warning(
                "Nitra: Unable to persist device token securely; it will need to be re-issued after restart."
            )
        return legacy_token

    entry_id = _get_secure_entry_id(state)
    return _load_device_token_secure(entry_id)


def _get_device_context() -> Tuple[Optional[str], Optional[str]]:
    """Return (device_token, fingerprint_hash) for downstream verification."""
    state = _read_device_state()
    fingerprint_hash = state.get('fingerprint_hash') if state else None
    token = _get_device_token()
    return token, fingerprint_hash


def _build_upstream_headers(access_token: Optional[str] = None, user_email: Optional[str] = None, user_id: Optional[str] = None, *, include_content_type: bool = True) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if include_content_type:
        headers['Content-Type'] = 'application/json'
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'
    if user_email:
        headers['X-User-Email'] = user_email
    if user_id:
        headers['X-User-Id'] = user_id
    device_state = _read_device_state()
    fingerprint_hash = device_state.get('fingerprint_hash') if device_state else None
    if fingerprint_hash:
        headers['X-Device-Fingerprint'] = fingerprint_hash
    device_token = _get_device_token()
    if device_token:
        headers['X-Device-Token'] = device_token
    return headers


class SubscriptionVerificationError(Exception):
    """Raised when subscription verification fails."""


class DeviceVerificationError(Exception):
    """Raised when device verification fails."""


def _verify_subscription_status(access_token: str, user_id: Optional[str]):
    if not user_id:
        raise SubscriptionVerificationError("User ID is required to verify subscription status.")
    import requests

    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    }
    response = requests.post(
        f'{WEBSITE_BASE_URL}/api/subscription-check',
        headers=headers,
        json={'userId': user_id},
        timeout=30,
    )
    if response.status_code != 200:
        raise SubscriptionVerificationError("Unable to verify subscription status with Nitra servers.")

    payload = response.json()
    if not payload.get('has_paid_subscription'):
        raise SubscriptionVerificationError("An active subscription is required to install premium assets.")


def _verify_device_registration(access_token: str, user_id: Optional[str], user_email: Optional[str]):
    import requests

    headers = _build_upstream_headers(access_token, user_email, user_id=user_id)
    device_token = headers.get('X-Device-Token')
    stored_fingerprint = headers.get('X-Device-Fingerprint')

    if not device_token:
        raise DeviceVerificationError("Register this machine before installing workflows or models.")
    if not stored_fingerprint:
        raise DeviceVerificationError("Machine fingerprint missing. Restart ComfyUI or re-register this device.")

    response = requests.get(
        f'{WEBSITE_BASE_URL}/api/device/slots',
        headers=headers,
        timeout=30,
    )
    if response.status_code == 401:
        # Try refreshing the token context from the request headers in case the local state is stale.
        debug_log("Device verify: upstream responded 401, attempting to refresh device context from headers.")
        refreshed_headers = _build_upstream_headers(access_token, user_email)
        response = requests.get(
            f'{WEBSITE_BASE_URL}/api/device/slots',
            headers=refreshed_headers,
            timeout=30,
        )
        if response.status_code == 401:
            raise DeviceVerificationError("Authentication expired. Please sign in again.")
    if response.status_code >= 400:
        raise DeviceVerificationError("Unable to verify device registration with Nitra servers.")

    try:
        payload = response.json()
    except Exception as exc:
        raise DeviceVerificationError(f"Invalid device verification response: {exc}")

    devices = payload.get('devices') or []
    debug_log(
        f"Device verify response: status={response.status_code} "
        f"count={len(devices)}"
    )
    
    # Collect fresh identity for comparison/debugging
    fresh_identity = _collect_device_identity()
    fresh_fingerprint = fresh_identity.get('fingerprint_hash')
    
    debug_log(
        f"Device verify fingerprints: stored={stored_fingerprint[:16] if stored_fingerprint else 'None'}... "
        f"fresh={fresh_fingerprint[:16] if fresh_fingerprint else 'None'}..."
    )
    
    if stored_fingerprint != fresh_fingerprint:
        debug_log(
            f"Device verify: FINGERPRINT MISMATCH detected. "
            f"Stored source might differ from current system state. "
            f"Fresh source: {fresh_identity.get('fingerprint_source', 'unknown')}"
        )
    
    for device in devices:
        device_hash = device.get('fingerprintHash')
        if device_hash == stored_fingerprint:
            debug_log(f"Device verify: matched stored fingerprint to device {device.get('deviceId')}")
            return
        if device_hash == fresh_fingerprint:
            debug_log(f"Device verify: matched fresh fingerprint to device {device.get('deviceId')}")
            return

    # Log all registered device hashes for debugging
    registered_hashes = [d.get('fingerprintHash', 'N/A')[:16] + '...' for d in devices]
    debug_log(f"Device verify: no match found. Registered hashes: {registered_hashes}")
    
    raise DeviceVerificationError("This machine is not registered. Register it in the Nitra device settings.")


def _require_subscription_and_device(access_token: str, user_id: Optional[str], user_email: Optional[str]):
    _verify_subscription_status(access_token, user_id)
    _verify_device_registration(access_token, user_id, user_email)


def _require_device_registration_only(access_token: str, user_id: Optional[str], user_email: Optional[str]):
    _verify_device_registration(access_token, user_id, user_email)


def _fetch_install_folder_names(access_token: Optional[str], user_email: Optional[str]) -> List[str]:
    if not access_token:
        return []

    try:
        import requests

        metadata_url = f'{WEBSITE_BASE_URL}/api/models-metadata'
        headers = _build_upstream_headers(access_token, user_email)
        response = requests.get(metadata_url, headers=headers, timeout=30)

        if response.status_code != 200:
            logger.warning(f"Nitra: Models metadata request failed ({response.status_code})")
            return []

        data = response.json()
        if isinstance(data, dict):
            models = data.get('models') or data.get('items') or data.get('data') or []
        elif isinstance(data, list):
            models = data
        else:
            models = []

        folder_names: List[str] = []
        seen = set()
        for model in models:
            if not isinstance(model, dict):
                continue
            folder = _normalize_install_folder_name(model.get('installFolder'))
            if not folder:
                continue
            key = folder.lower()
            if key in seen:
                continue
            seen.add(key)
            folder_names.append(folder)

        logger.info(f"Nitra: Discovered {len(folder_names)} install folder(s) from metadata")
        return folder_names
    except Exception as exc:
        logger.warning(f"Nitra: Failed to fetch install folders: {exc}")
        return []


def _safe_read_text_file(path: str) -> Optional[str]:
    try:
        p = Path(path)
        if p.exists():
            contents = p.read_text(encoding='utf-8', errors='ignore').strip()
            return contents or None
    except Exception:
        pass
    return None


def _run_command_output(command: List[str]) -> Optional[str]:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def _extract_first_value(output: Optional[str], skip: Optional[List[str]] = None) -> Optional[str]:
    if not output:
        return None
    skip_values = {value.lower() for value in (skip or [])}
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower() in skip_values:
            continue
        return line
    return None


def _collect_device_identity() -> Dict[str, Any]:
    identity: Dict[str, Any] = {}
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = ''

    try:
        machine_name = platform.node()
    except Exception:
        machine_name = hostname

    identity['hostname'] = hostname
    identity['machine_name'] = machine_name or hostname
    identity['platform'] = platform.system()
    identity['platform_release'] = platform.release()
    identity['platform_version'] = platform.version()
    identity['architecture'] = platform.machine()
    identity['processor'] = platform.processor()
    identity['python_version'] = platform.python_version()

    fingerprint_components: List[str] = []

    def add_component(name: str, value: Optional[str]):
        if value:
            identity[name] = value
            fingerprint_components.append(f"{name}:{value}")

    try:
        mac_val = uuid.getnode()
        if mac_val:
            add_component('mac_address', f"{mac_val:012x}")
    except Exception:
        pass

    add_component('machine_id', _safe_read_text_file('/etc/machine-id'))

    system_name = (identity['platform'] or '').lower()
    if system_name == 'linux':
        add_component('board_serial', _safe_read_text_file('/sys/class/dmi/id/board_serial'))
        add_component('product_uuid', _safe_read_text_file('/sys/class/dmi/id/product_uuid'))
    elif system_name == 'windows':
        add_component(
            'product_uuid',
            _extract_first_value(_run_command_output(['wmic', 'csproduct', 'get', 'uuid']), ['uuid'])
        )
        add_component(
            'baseboard_serial',
            _extract_first_value(_run_command_output(['wmic', 'baseboard', 'get', 'serialnumber']), ['serialnumber'])
        )
    elif system_name == 'darwin':
        ioreg_output = _run_command_output(['ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'])
        platform_uuid = None
        if ioreg_output:
            for line in ioreg_output.splitlines():
                if 'IOPlatformUUID' in line:
                    platform_uuid = line.split('=')[-1].strip().strip('"')
                    break
        add_component('platform_uuid', platform_uuid)

    fingerprint_source = "||".join(fingerprint_components) or identity['machine_name'] or identity['hostname'] or 'unknown-device'
    identity['fingerprint_hash'] = hashlib.sha256(fingerprint_source.encode('utf-8', errors='ignore')).hexdigest()
    identity['fingerprint_components'] = fingerprint_components
    identity['fingerprint_source'] = fingerprint_source
    identity['collected_at'] = datetime.now(timezone.utc).isoformat()
    identity['default_label'] = identity['machine_name']

    return identity


def _parse_upstream_json_response(response):
    try:
        return response.json()
    except Exception:
        text = response.text if hasattr(response, 'text') else ''
        return {'message': text} if text else {}


@routes.get('/nitra/user-config')
async def get_user_config(request):
    try:
        path = _get_user_config_path()
        if not os.path.exists(path):
            return web.json_response({'extra_model_paths': [], 'huggingface_token': ''})
        data = _read_toml_safe(path)
        # Normalize types
        extra_model_paths = data.get('extra_model_paths') or []
        if not isinstance(extra_model_paths, list):
            extra_model_paths = []
        huggingface_token = data.get('huggingface_token') or ''
        return web.json_response({
            'extra_model_paths': extra_model_paths,
            'huggingface_token': huggingface_token
        })
    except Exception as e:
        logger.error(f"Nitra: get_user_config error: {e}")
        return web.json_response({'error': 'Internal server error'}, status=500)


@routes.post('/nitra/user-config')
async def save_user_config(request):
    try:
        data = await request.json()
        extra_model_paths = data.get('extra_model_paths') or []
        huggingface_token = data.get('huggingface_token') or ''
        if not isinstance(extra_model_paths, list):
            return web.json_response({'error': 'extra_model_paths must be a list'}, status=400)
        # Fail fast: ensure all paths are strings, and normalize by stripping
        # Unicode control characters (e.g., U+202A from Windows copy/paste) and
        # surrounding whitespace so the stored config is clean.
        normalized_paths = []
        for p in extra_model_paths:
            if not isinstance(p, str):
                return web.json_response({'error': 'All extra_model_paths must be strings'}, status=400)
            # Remove control-format characters and trim whitespace
            cleaned = ''.join(
                ch for ch in p
                if unicodedata.category(ch) != 'Cf'
            ).strip()
            if cleaned:
                normalized_paths.append(cleaned)
        extra_model_paths = normalized_paths
        cfg = {
            'extra_model_paths': extra_model_paths,
            'huggingface_token': huggingface_token
        }
        path = _get_user_config_path()
        ok = _write_toml_safe(path, cfg)
        if not ok:
            return web.json_response({'error': 'Failed to write configuration'}, status=500)
        
        # Always update extra_model_paths.yaml (creates, updates, or deletes based on path)
        # Support for one extra model path - take the first one, or empty string if none
        base_path = ''
        if extra_model_paths and len(extra_model_paths) > 0:
            base_path = extra_model_paths[0].strip()

        detected_folders: Optional[List[str]] = None
        auth_header = request.headers.get('Authorization', '')
        access_token = auth_header[7:] if auth_header and auth_header.startswith('Bearer ') else ''
        user_email = request.headers.get('X-User-Email', '')

        if base_path and access_token:
            detected = _fetch_install_folder_names(access_token, user_email)
            detected_folders = detected if detected else None
        elif base_path and not access_token:
            logger.info("Nitra: No auth token provided when saving user config; skipping dynamic folder discovery")
        
        yaml_updated = _update_extra_model_paths_yaml(base_path, detected_folders)
        if not yaml_updated:
            logger.warning("Failed to update extra_model_paths.yaml, but config was saved")
        
        return web.json_response({'success': True})
    except Exception as e:
        logger.error(f"Nitra: save_user_config error: {e}")
        return web.json_response({'error': 'Internal server error'}, status=500)


@routes.get('/nitra/device/identity')
async def get_device_identity(request):
    try:
        identity = _collect_device_identity()
        device_state = _read_device_state()
        token_present = bool(_get_device_token())
        identity['has_stored_token'] = token_present
        identity['stored_device'] = None
        if device_state:
            identity['stored_device'] = {
                'device_id': device_state.get('device_id'),
                'device_label': device_state.get('device_label'),
                'registered_at': device_state.get('registered_at'),
                'fingerprint_hash': device_state.get('fingerprint_hash')
            }
        return web.json_response(identity)
    except Exception as e:
        logger.error(f"Nitra: device identity error: {e}")
        return web.json_response({'error': 'Failed to collect device identity'}, status=500)


@routes.get('/nitra/debug/device-status')
async def debug_device_status(request):
    """Return local vs remote device info to help troubleshoot device checks."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Missing bearer token'}, status=401)

        access_token = auth_header[7:]
        user_email = request.headers.get('X-User-Email')
        user_id = request.headers.get('X-User-Id')
        headers = _build_upstream_headers(access_token, user_email, user_id=user_id)

        device_state = _read_device_state() or {}
        identity = _collect_device_identity()

        upstream_status: Dict[str, Any]
        import requests
        try:
            resp = requests.get(
                f'{WEBSITE_BASE_URL}/api/device/slots',
                headers=headers,
                timeout=30,
            )
            try:
                body = resp.json()
            except Exception:
                body = resp.text
            upstream_status = {
                'status': resp.status_code,
                'body': body,
            }
        except Exception as exc:
            upstream_status = {
                'status': 'error',
                'error': str(exc),
            }

        local_summary = {
            'has_device_token': bool(headers.get('X-Device-Token')),
            'stored_fingerprint': device_state.get('fingerprint_hash'),
            'identity_fingerprint': identity.get('fingerprint_hash'),
            'device_label': device_state.get('device_label'),
            'device_id': device_state.get('device_id'),
            'user_id': user_id or device_state.get('user_id'),
            'user_email': user_email or device_state.get('user_email'),
        }

        return web.json_response({
            'local_state': local_summary,
            'upstream': upstream_status,
        })
    except Exception as exc:
        logger.error(f"Nitra: debug device status error: {exc}")
        return web.json_response({'error': 'Failed to gather device status'}, status=500)


@routes.get('/nitra/device/registrations')
async def list_device_registrations(request):
    auth_header = request.headers.get('Authorization', '')
    if not auth_header or not auth_header.startswith('Bearer '):
        return web.json_response({'error': 'Unauthorized'}, status=401)
    user_email = request.headers.get('X-User-Email', '')
    user_id = request.headers.get('X-User-Id', '')
    try:
        import requests
        url = f"{WEBSITE_BASE_URL}/api/device/slots"
        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json'
        }
        if user_email:
            headers['X-User-Email'] = user_email
        if user_id:
            headers['X-User-Id'] = user_id
        resp = requests.get(url, headers=headers, timeout=30)
        data = _parse_upstream_json_response(resp)
        return web.json_response(data, status=resp.status_code)
    except Exception as e:
        logger.error(f"Nitra: device registrations error: {e}")
        return web.json_response({'error': 'Failed to fetch device registrations'}, status=500)


@routes.post('/nitra/device/register')
async def register_device(request):
    auth_header = request.headers.get('Authorization', '')
    if not auth_header or not auth_header.startswith('Bearer '):
        return web.json_response({'error': 'Unauthorized'}, status=401)
    user_email = request.headers.get('X-User-Email', '')
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    try:
        device_label = payload.get('device_label')
        replace_device_id = payload.get('replace_device_id')
        mode = payload.get('mode', 'manual')
        client_timestamp = payload.get('client_timestamp')
        source = payload.get('source', 'comfyui-nitra')

        identity = _collect_device_identity()
        device_state = _read_device_state()

        upstream_payload = {
            'mode': mode,
            'deviceLabel': device_label or identity.get('machine_name') or identity.get('hostname'),
            'replaceDeviceId': replace_device_id,
            'clientTimestamp': client_timestamp,
            'source': source,
            'identity': identity
        }

        if device_state.get('device_token'):
            upstream_payload['existingDeviceToken'] = device_state.get('device_token')
        if device_state.get('device_id'):
            upstream_payload['storedDeviceId'] = device_state.get('device_id')
        if device_state.get('fingerprint_hash'):
            upstream_payload['storedFingerprintHash'] = device_state.get('fingerprint_hash')

        import requests
        url = f"{WEBSITE_BASE_URL}/api/device/register"
        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json'
        }
        if user_email:
            headers['X-User-Email'] = user_email
        fingerprint_hash = identity.get('fingerprint_hash')
        if fingerprint_hash:
            headers['X-Device-Fingerprint'] = fingerprint_hash

        resp = requests.post(url, headers=headers, json=upstream_payload, timeout=45)
        resp_body = _parse_upstream_json_response(resp)

        stored_token = resp_body.pop('deviceToken', None)
        if resp.ok and stored_token and resp_body.get('deviceId'):
            entry_id = resp_body.get('deviceId') or fingerprint_hash or 'nitra-device'
            stored_securely = _store_device_token_secure(entry_id, stored_token)
            if not stored_securely:
                logger.warning("Nitra: Device token could not be stored securely; it will expire after restart.")
            _write_device_state({
                'device_id': resp_body.get('deviceId'),
                'device_label': resp_body.get('deviceLabel') or upstream_payload['deviceLabel'],
                'registered_at': resp_body.get('registeredAt') or datetime.now(timezone.utc).isoformat(),
                'fingerprint_hash': fingerprint_hash,
                'machine_name': identity.get('machine_name'),
                'secure_entry_id': entry_id
            })
        elif resp.ok and resp_body.get('status') == 'device-unregistered':
            _write_device_state(None)

        return web.json_response(resp_body, status=resp.status_code)
    except Exception as e:
        logger.error(f"Nitra: device register error: {e}")
        return web.json_response({'error': 'Failed to register device'}, status=500)


@routes.post('/nitra/telemetry/login')
async def telemetry_login(request):
    auth_header = request.headers.get('Authorization', '')
    if not auth_header or not auth_header.startswith('Bearer '):
        return web.json_response({'error': 'Unauthorized'}, status=401)
    user_email = request.headers.get('X-User-Email', '')
    try:
        body = await request.json()
    except Exception:
        body = {}

    try:
        identity = _collect_device_identity()
        device_state = _read_device_state()
        telemetry_payload = {
            'identity': identity,
            'deviceState': {
                'deviceId': device_state.get('device_id'),
                'deviceLabel': device_state.get('device_label'),
                'fingerprintHash': device_state.get('fingerprint_hash')
            } if device_state else None,
            'clientTimestamp': body.get('client_timestamp'),
            'source': body.get('source', 'comfyui-nitra'),
            'context': body.get('context', {})
        }

        import requests
        url = f"{WEBSITE_BASE_URL}/api/telemetry/login"
        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json'
        }
        if user_email:
            headers['X-User-Email'] = user_email
        fingerprint_hash = identity.get('fingerprint_hash') or (device_state or {}).get('fingerprint_hash')
        if fingerprint_hash:
            headers['X-Device-Fingerprint'] = fingerprint_hash

        resp = requests.post(url, headers=headers, json=telemetry_payload, timeout=30)
        resp_body = _parse_upstream_json_response(resp)
        return web.json_response(resp_body, status=resp.status_code)
    except Exception as e:
        logger.error(f"Nitra: telemetry login error: {e}")
        return web.json_response({'error': 'Failed to record telemetry'}, status=500)

@routes.get('/nitra/custom-nodes')
async def get_custom_nodes(request):
    """Get all active custom nodes from admin subdomain"""
    try:
        # Basic auth check (similar to existing model/workflow routes)
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({"error": "Missing or invalid authorization header"}, status=401)
        
        access_token = auth_header[7:]
        if not access_token:
            return web.json_response({"error": "Missing access token"}, status=401)
        
        user_email = request.query.get('userEmail', '')
        if not user_email: # Fallback to decode JWT token
            import base64, json as json_lib
            token_parts = access_token.split('.')
            if len(token_parts) != 3: return web.json_response({"error": "Invalid token format"}, status=401)
            payload_b64 = token_parts[1]
            payload_b64 += '=' * (4 - len(payload_b64) % 4)
            payload = json_lib.loads(base64.b64decode(payload_b64))
            user_email = payload.get('email') or payload.get('user_email', '')
        
        import requests
        custom_nodes_url = f'{WEBSITE_BASE_URL}/api/custom-nodes' # Target upstream API
        headers = _build_upstream_headers(access_token, user_email)
        response = requests.get(custom_nodes_url, headers=headers, timeout=30)
        response.raise_for_status()
        custom_nodes_data = response.json()
        return web.json_response(custom_nodes_data)
    except Exception as e:
        logger.error(f"Nitra: Custom nodes fetch error: {e}")
        return web.json_response({"error": "Internal server error"}, status=500)

@routes.get('/nitra/node-mappings')
async def get_node_mappings(request):
    """Return extension-node-map from ComfyUI-Manager for node type matching."""
    try:
        # Look for ComfyUI-Manager's extension-node-map.json in sibling custom_nodes folder
        nitra_dir = os.path.dirname(__file__)
        custom_nodes_dir = os.path.dirname(nitra_dir)
        manager_map_path = os.path.join(custom_nodes_dir, 'ComfyUI-Manager', 'extension-node-map.json')
        
        if os.path.exists(manager_map_path):
            with open(manager_map_path, 'r', encoding='utf-8') as f:
                node_mappings = json.load(f)
            return web.json_response(node_mappings)
        else:
            logger.warning(f"Nitra: extension-node-map.json not found at {manager_map_path}")
            return web.json_response({})
    except Exception as e:
        logger.error(f"Nitra: Failed to load node mappings: {e}")
        return web.json_response({})

debug_log("Routes registered successfully")