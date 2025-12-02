"""
Environment and package management for ComfyUI setup
"""

import os
import sys
import tempfile
from typing import Optional

from .config import ComfyUIConfig
from .utils import run_command, is_windows, run_pip_subprocess
from .logging_setup import get_logger

logger = get_logger(__name__)


def sync_onnxruntime_version(config: ComfyUIConfig) -> None:
    """
    Ensure onnxruntime using GPU
    
    Args:
        config: ComfyUI configuration
    """
    logger.info("Syncing onnxruntime version...")
    run_pip_subprocess(config.venv_pip, ['uninstall', '-y', 'onnxruntime'], log_output=False)
    run_pip_subprocess(
        config.venv_pip,
        ['install', '--upgrade', '--no-warn-script-location', 'onnxruntime-gpu', 'onnx'],
        log_output=False,
    )

def install_frontend_package(config: ComfyUIConfig) -> None:
    """
    Install/update ComfyUI frontend package
    
    Args:
        config: ComfyUI configuration
    """
    logger.info("Installing/updating ComfyUI frontend package...")
    run_pip_subprocess(
        config.venv_pip,
        ['install', '-U', '--no-warn-script-location', 'comfyui_frontend_package'],
        log_output=False,
    )


def ensure_model_directories(config: ComfyUIConfig) -> None:
    """
    Ensure all required model subdirectories exist
    
    Args:
        config: ComfyUI configuration
    """
    logger.info("Ensuring model subdirectories...")
    model_dirs = [
        'diffusion_models', 'checkpoints', 'vae', 'controlnet', 
        'loras', 'clip_vision', 'text_encoders'
    ]
    for subdir in model_dirs:
        os.makedirs(os.path.join(config.app_dir, 'models', subdir), exist_ok=True)
        logger.debug(f"Ensured model directory: models/{subdir}")


