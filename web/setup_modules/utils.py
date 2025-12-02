"""
Common utilities for ComfyUI setup
"""

import subprocess
import os
from typing import List, Optional
from subprocess import CompletedProcess
from .logging_setup import get_logger

logger = get_logger(__name__)


def run_command(cmd: List[str], cwd: Optional[str] = None, capture_output: bool = False, 
                log_output: bool = True) -> subprocess.CompletedProcess:
    """
    Run a command with proper logging and error handling
    
    Args:
        cmd: Command and arguments as a list
        cwd: Working directory for the command
        capture_output: Whether to capture stdout/stderr
        log_output: Whether to log command output
        
    Returns:
        CompletedProcess instance
    """
    logger.info(f"Running command: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd, 
            cwd=cwd, 
            capture_output=capture_output,
            text=True,
            check=False  # We'll handle return codes manually
        )
        
        if log_output and result.stdout:
            logger.info(f"Command output: {result.stdout}")
        if result.stderr:
            logger.warning(f"Command stderr: {result.stderr}")
            
        return result
    except Exception as e:
        logger.error(f"Command failed: {e}")
        raise


def run_pip_subprocess(
    pip_cmd: List[str],
    args: List[str],
    *,
    cwd: Optional[str] = None,
    log_output: bool = True,
) -> CompletedProcess:
    """
    Run pip in a fully separate Python process that shares the same interpreter/venv
    but avoids reusing the currently running interpreter state.
    """
    cmd = list(pip_cmd) + args
    logger.info(f"Running pip command in isolated process: {' '.join(cmd)}")

    try:
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
            close_fds=True,
        )
    except Exception as exc:
        logger.error(f"Failed to launch pip command: {exc}")
        raise

    output_lines: List[str] = []
    try:
        if process.stdout:
            for line in process.stdout:
                output_lines.append(line)
                if log_output:
                    logger.info(line.rstrip())
        return_code = process.wait()
    finally:
        if process.stdout:
            process.stdout.close()

    if return_code != 0:
        logger.error(f"Pip command failed with exit code {return_code}")

    return CompletedProcess(cmd, return_code, ''.join(output_lines), None)


def ensure_directory(path: str) -> None:
    """
    Ensure a directory exists, creating it if necessary
    
    Args:
        path: Directory path to create
    """
    os.makedirs(path, exist_ok=True)
    logger.debug(f"Ensured directory exists: {path}")


def is_windows() -> bool:
    """Check if running on Windows"""
    return os.name == 'nt'


def format_file_size(size_bytes: int) -> str:
    """
    Format file size in human-readable format, prioritizing GB for larger files
    
    Args:
        size_bytes: Size in bytes
        
    Returns:
        Formatted size string (e.g., "1.5 GB")
    """
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        # For files less than 1GB, show MB
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        # For files 1GB and above, show GB
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"


def validate_path_security(path: str, base_path: str = None) -> bool:
    """
    Validate that a path is safe (no directory traversal)
    
    Args:
        path: Path to validate
        base_path: Base path to check against (optional)
        
    Returns:
        True if path is safe, False otherwise
    """
    if '..' in path or path.startswith('/'):
        return False
    
    if base_path:
        # Resolve full paths and check containment
        try:
            full_path = os.path.abspath(os.path.join(base_path, path))
            base_full = os.path.abspath(base_path)
            return full_path.startswith(base_full)
        except (OSError, ValueError):
            return False
    
    return True
