"""
Model and file downloading functionality for ComfyUI setup
"""

import os

# Disable HuggingFace symlink warnings globally
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'
# Force tqdm to show even in non-TTY environments (piped subprocess)
os.environ['TQDM_DISABLE'] = 'False'
os.environ['TQDM_MININTERVAL'] = '0.1'  # Update every 0.1 seconds for smooth progress
os.environ['TQDM_ASCII'] = 'True'  # Use ASCII progress bars
import csv
import shutil
import tempfile
from urllib.parse import urlparse, unquote
from typing import Optional, Dict
import requests
from huggingface_hub import hf_hub_download
from huggingface_hub.utils import HfHubHTTPError
from tqdm import tqdm
import sys

import functools

# Mimic workflow downloader behavior: treat as TTY so tqdm uses carriage returns.
_original_stderr_isatty = sys.stderr.isatty
_original_stdout_isatty = sys.stdout.isatty
sys.stderr.isatty = lambda: True
sys.stdout.isatty = lambda: True

# Configure tqdm to be compact and overwrite in-place
tqdm.monitor_interval = 0
_original_tqdm_init = tqdm.__init__

@functools.wraps(_original_tqdm_init)
def _tqdm_init_compact(self, *args, **kwargs):
    kwargs.setdefault('ascii', True)
    kwargs.setdefault('ncols', 80)
    kwargs.setdefault('mininterval', 0.5)
    kwargs.setdefault('maxinterval', 2.0)
    kwargs.setdefault('leave', False)
    kwargs.setdefault('dynamic_ncols', True)
    kwargs.setdefault('file', sys.stderr)
    return _original_tqdm_init(self, *args, **kwargs)

tqdm.__init__ = _tqdm_init_compact

if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(line_buffering=False)
    except Exception:
        pass

from .config import ComfyUIConfig
from .utils import validate_path_security, format_file_size
from .logging_setup import get_logger

logger = get_logger(__name__)


def normalize_hf_url(file_url: str) -> str:
    """Normalize HuggingFace blob URLs to resolve URLs"""
    return file_url.replace('/blob/', '/resolve/')


def parse_hf_url(url: str) -> Optional[Dict[str, str]]:
    """
    Parse a HuggingFace URL to extract repo_id and filename
    
    Args:
        url: HuggingFace URL to parse
        
    Returns:
        Dict with repo_id and filename, or None if parsing fails
    """
    try:
        # Remove query parameters and fragments
        clean_url = url.split('?')[0].split('#')[0]
        
        # Check if it's a HuggingFace URL
        if 'huggingface.co' in clean_url:
            parts = clean_url.split('/')
            if len(parts) >= 8:  # Need at least 8 parts for a valid file URL
                # Format: https://huggingface.co/username/repo/resolve/branch/filename
                # parts[0]: 'https:', parts[1]: '', parts[2]: 'huggingface.co'
                # parts[3]: 'username', parts[4]: 'repo', parts[5]: 'resolve'
                # parts[6]: 'branch' (main), parts[7+]: 'filename'
                repo_id = f"{parts[3]}/{parts[4]}"
                filename = '/'.join(parts[7:])  # Skip the branch, take filename
                return {'repo_id': repo_id, 'filename': filename}
    except Exception as e:
        logger.warning(f"Failed to parse HF URL {url}: {e}")
    
    return None


def download_model(file_url: str, output_name: str = "", models_subdir: str = "", config: ComfyUIConfig = None) -> bool:
    """
    Download a model file using huggingface_hub or direct download
    
    Args:
        file_url: URL to download from
        output_name: Output filename (can include subdirectory path like "subfolder/file.ext")
        models_subdir: Base model subdirectory (e.g., "checkpoints", "diffusion_models")
        config: ComfyUI configuration
        
    Returns:
        True if download successful, False otherwise
    """
    if not file_url:
        logger.error("download_model: missing file_url")
        return False
    
    if not config:
        logger.error("download_model: config is required")
        return False
    
    # Debug: Log the paths
    print(f"[DOWNLOAD] ComfyUI directory: {config.comfy_dir}")
    print(f"[DOWNLOAD] App directory: {config.app_dir}")
    
    # Normalize HF URLs
    file_url = normalize_hf_url(file_url)
    
    # Parse URL to get filename if not provided
    if not output_name:
        url_path = unquote(urlparse(file_url).path)
        output_name = os.path.basename(url_path)
    
    # Default models subdirectory
    if not models_subdir:
        models_subdir = "diffusion_models"
    
    # Security validation
    if not validate_path_security(models_subdir) or not validate_path_security(output_name):
        logger.error(f"download_model: invalid path - models_subdir: {models_subdir}, output_name: {output_name}")
        return False
    
    # Determine base directory for models:
    # - Prefer an explicit models_root_dir (which may come from an extra model path)
    # - Fall back to the standard ComfyUI app_dir/models if not set
    models_root = getattr(config, 'models_root_dir', None) or config.app_dir

    # Handle nested output paths
    dest_dir = os.path.join(models_root, 'models', models_subdir)
    print(f"[DOWNLOAD] Destination directory: {dest_dir}")
    
    # If output_name contains path separators, create nested directories
    if '/' in output_name or '\\' in output_name:
        output_name = output_name.replace('\\', '/')
        output_dir = os.path.dirname(output_name)
        if output_dir:
            dest_dir = os.path.join(dest_dir, output_dir)
        output_filename = os.path.basename(output_name)
    else:
        output_filename = output_name
    
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, output_filename)
    
    if os.path.isfile(dest_path):
        logger.info(f"Model already exists, skipping: {dest_path}")
        return True
    
    # Try HuggingFace download first
    if _try_hf_download(file_url, dest_dir, output_filename, config.hf_token):
        return True
    
    # Fall back to direct download
    return _try_direct_download(file_url, dest_path, config.hf_token)


def _try_hf_download(file_url: str, dest_dir: str, output_filename: str, hf_token: Optional[str]) -> bool:
    """Try downloading from HuggingFace Hub"""
    hf_info = parse_hf_url(file_url)
    if not hf_info:
        logger.debug(f"URL is not a HuggingFace URL: {file_url}")
        return False
    
    logger.debug(f"Parsed HF URL - repo_id: {hf_info['repo_id']}, filename: {hf_info['filename']}")
    
    # Create a temporary cache directory that will be cleaned up
    temp_cache_dir = None
    try:
        token_status = "with token" if hf_token else "without token"
        logger.info(f"Downloading from HuggingFace ({token_status}): {hf_info['repo_id']}/{hf_info['filename']}")
        
        # Create temporary cache directory to avoid persistent caching
        temp_cache_dir = tempfile.mkdtemp(prefix="hf_cache_")
        
        # Download to temporary cache, then copy to final location
        download_kwargs = {
            'repo_id': hf_info['repo_id'],
            'filename': hf_info['filename'],
            'cache_dir': temp_cache_dir,
        }
        
        # Only add token if it's provided and not empty
        if hf_token and hf_token.strip():
            download_kwargs['token'] = hf_token
        
        # hf_hub_download uses tqdm by default - our updated handle_stream can handle it
        downloaded_file = hf_hub_download(**download_kwargs)
        
        # Move the downloaded file to our desired location with the correct name
        final_path = os.path.join(dest_dir, output_filename)
        shutil.copy2(downloaded_file, final_path)
        logger.info(f"   Copied to: {final_path}")
        
        # Get final file size
        if os.path.exists(final_path):
            file_size = os.path.getsize(final_path)
            logger.info(f"   Successfully downloaded: {output_filename} ({format_file_size(file_size)})")
        
        return True
        
    except HfHubHTTPError as e:
        logger.warning(f"HuggingFace download failed (HTTP error): {e}")
        logger.info("Falling back to direct download...")
        return False
    except Exception as e:
        logger.warning(f"HuggingFace download failed: {e}")
        logger.info("Falling back to direct download...")
        return False
    finally:
        # Clean up temporary cache directory
        if temp_cache_dir and os.path.exists(temp_cache_dir):
            try:
                shutil.rmtree(temp_cache_dir)
            except Exception:
                # Ignore cleanup errors
                pass


def _try_direct_download(file_url: str, dest_path: str, hf_token: Optional[str]) -> bool:
    """Try direct HTTP download"""
    try:
        logger.info(f"Downloading directly: {file_url}")
        headers = {}
        if hf_token and 'huggingface.co' in file_url:
            headers['Authorization'] = f'Bearer {hf_token}'
            logger.info("Using HuggingFace token for direct download")
        
        response = requests.get(file_url, headers=headers, stream=True)
        response.raise_for_status()
        
        # Get content length for progress tracking
        total_size = int(response.headers.get('content-length', 0))
        if total_size > 0:
            logger.info(f"   File size: {format_file_size(total_size)}")
        
        # Download with simple progress tracking
        downloaded_size = 0
        last_logged_percent = 0
        logged_100_percent = False
        
        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    
                    # Log progress every 10% for direct downloads
                    if total_size > 0:
                        percent = (downloaded_size / total_size) * 100
                        should_log = False
                        
                        # Log every 10% or at 100% (but only once for 100%)
                        if percent - last_logged_percent >= 10:
                            should_log = True
                        elif percent >= 99.9 and not logged_100_percent:
                            should_log = True
                            logged_100_percent = True
                        
                        if should_log:
                            output_filename = os.path.basename(dest_path)
                            logger.info(f"   {output_filename}: {percent:.1f}% ({format_file_size(downloaded_size)}/{format_file_size(total_size)})")
                            last_logged_percent = percent
        
        logger.info(f"   Successfully downloaded: {dest_path} ({format_file_size(downloaded_size)})")
        return True
        
    except Exception as e:
        logger.error(f"Failed to download {file_url}: {e}")
        return False


def install_models_from_csv(csv_file: str, config: ComfyUIConfig) -> None:
    """
    Bulk model downloads from CSV: columns = url, output_path, [models_subdir]
    
    Args:
        csv_file: Path to CSV file containing model URLs
        config: ComfyUI configuration
    """
    if not os.path.isfile(csv_file):
        logger.warning(f"Model CSV file not found: {csv_file}")
        return
    
    logger.info(f"Installing models from {csv_file}")
    
    # First pass: count total rows for progress tracking
    total_models = _count_models_in_csv(csv_file)
    logger.info(f"Found {total_models} models to download")
    
    downloaded_count = 0
    try:
        with open(csv_file, 'r', newline='', encoding='utf-8') as f:
            reader = csv.reader(f)
            for row_num, row in enumerate(reader, 1):
                if not row:
                    continue
                
                # Parse CSV columns
                url = row[0].strip().strip('"') if len(row) > 0 else ""
                output_path = row[1].strip().strip('"') if len(row) > 1 else ""
                models_subdir = row[2].strip().strip('"') if len(row) > 2 else ""
                
                # Skip blanks, comments, and header rows
                if not url or url.startswith('#') or url.lower() in ['url', 'download_url']:
                    continue
                
                downloaded_count += 1
                progress = f"({downloaded_count}/{total_models})" if total_models > 0 else f"({downloaded_count})"
                logger.info(f"Processing model {progress}: {url}")
                
                # Determine output filename and subdirectory
                output_name, final_subdir = _parse_model_path(output_path, models_subdir)
                
                logger.info(f"   └── Downloading to: models/{final_subdir}/{output_name}")
                
                success = download_model(url, output_name, final_subdir, config)
                if success:
                    logger.info(f"   [OK] Model {downloaded_count} downloaded successfully")
                else:
                    logger.error(f"   [ERROR] Model {downloaded_count} download failed")
        
        logger.info(f"Model installation completed: {downloaded_count} models processed")
        
    except Exception as e:
        logger.error(f"Error processing models CSV {csv_file}: {e}")
        raise


def _count_models_in_csv(csv_file: str) -> int:
    """Count the number of valid model entries in CSV file"""
    total_models = 0
    try:
        with open(csv_file, 'r', newline='', encoding='utf-8') as f:
            reader = csv.reader(f)
            for row in reader:
                if row and row[0].strip() and not row[0].strip().startswith('#') and row[0].strip().lower() not in ['url', 'download_url']:
                    total_models += 1
    except Exception:
        total_models = 0
    return total_models


def _parse_model_path(output_path: str, models_subdir: str) -> tuple[str, str]:
    """
    Parse the output path and models subdirectory
    
    Returns:
        Tuple of (output_name, final_subdir)
    """
    if output_path:
        # Check if output_path contains directory separators
        if '/' in output_path or '\\' in output_path:
            # Split into subdirectory and filename
            path_parts = output_path.replace('\\', '/').split('/')
            if len(path_parts) > 1:
                suggested_subdir = path_parts[0]
                output_name = '/'.join(path_parts[1:])
                # Use the path-derived subdir unless explicitly overridden
                if not models_subdir:
                    models_subdir = suggested_subdir
            else:
                output_name = output_path
        else:
            # Just a filename
            output_name = output_path
    else:
        # No output path specified, derive from URL
        output_name = ""
    
    # Default subdir if still empty
    if not models_subdir:
        models_subdir = "diffusion_models"
    
    return output_name, models_subdir
