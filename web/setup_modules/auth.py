"""
Authentication and license validation for ComfyUI setup
"""

import os
import json
import tempfile
import zipfile
import shutil
from typing import Optional, Tuple
import requests

from .config import ComfyUIConfig
from .logging_setup import get_logger

logger = get_logger(__name__)


def _mask_token(token: Optional[str]) -> str:
    if not token:
        return "<none>"
    if len(token) <= 8:
        return "***"
    return f"{token[:4]}...{token[-4:]}"


class AuthenticationError(Exception):
    """Raised when authentication fails"""
    pass


class LicenseValidationError(Exception):
    """Raised when license validation fails"""
    pass


def validate_authentication(config: ComfyUIConfig) -> bool:
    """
    Validate that the user has proper authentication
    
    Args:
        config: ComfyUI configuration
        
    Returns:
        True if authenticated, False otherwise
    """
    if not config.user_id or not config.user_email or not config.access_token:
        logger.error("❌ You do not have a valid license. Please purchase a license to receive updates.")
        logger.info("No authenticated user session found.")
        return False
    
    logger.info(f"Authenticated user session found: {config.user_email}")
    return True

def fetch_license_status(config: ComfyUIConfig) -> str:
    """
    Fetch license status from the main website API
    
    Args:
        config: ComfyUI configuration
        
    Returns:
        License status
    """
    try:
        # Use user authentication with the main website API endpoint
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {config.access_token}',
            'User-Agent': 'ComfyUI-Nitra/1.0'
        }
        api_server_url = f"{config.configs_url}/license-status"
        logger.info(f"Using license status URL: {api_server_url}")
        response = requests.get(api_server_url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch license status: {e}")
        return "Invalid"


def fetch_configs_from_license_server(config: ComfyUIConfig) -> Tuple[bool, Optional[str]]:
    """
    Fetch configs from the main website API using authenticated user session
    
    Args:
        config: ComfyUI configuration
        
    Returns:
        Tuple of (success, extracted_config_dir)
    """
    if not validate_authentication(config):
        return False, None
    
    # Use the main website API endpoint
    api_server_url = f"{config.configs_url}/comfyconfigs"
    logger.info(f"Using configs server URL: {api_server_url}")
    
    # Ensure config directories exist
    os.makedirs(os.path.dirname(config.custom_nodes_csv), exist_ok=True)
    os.makedirs(os.path.dirname(config.model_urls_csv), exist_ok=True)
    
    logger.info(f"Requesting config URLs for authenticated user: {config.user_email}")
    
    try:
        # Use user authentication with the main website API endpoint
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {config.access_token}',
            'User-Agent': 'ComfyUI-Nitra/1.0'
        }
        
        logger.info(f"Making authenticated request to: {api_server_url}")
        safe_headers = dict(headers)
        if 'Authorization' in safe_headers:
            safe_headers['Authorization'] = f"Bearer {_mask_token(config.access_token)}"
        logger.info(f"Request headers: {safe_headers}")
        
        response = requests.get(api_server_url, headers=headers, timeout=30)
        logger.info(f"Response status: {response.status_code}")
        logger.info(f"Response text: {response.text}")
        
        response.raise_for_status()
        
        response_data = response.json()
        logger.info(f"Received configs for user {config.user_email}: {list(response_data.keys()) if isinstance(response_data, dict) else type(response_data)}")
        
        # Handle nested JSON response
        if isinstance(response_data, dict) and 'body' in response_data:
            try:
                urls_data = json.loads(response_data['body'])
            except json.JSONDecodeError:
                urls_data = response_data
        else:
            urls_data = response_data
        
        # Extract the download URL
        configs_zip_url = urls_data.get('download_url')
        
        if not configs_zip_url:
            logger.error(f"No download_url in response. Available keys: {list(urls_data.keys()) if isinstance(urls_data, dict) else 'not a dict'}")
            return False, None
        
        logger.info(f"Config zip URL: {configs_zip_url}")
        logger.info("Downloading licensed configs zip...")
        
        # Download and extract zip
        extracted_config_dir = _download_and_extract_configs(configs_zip_url, config)
        
        if extracted_config_dir:
            logger.info("Config fetch successful. Extracted config directory available for processing.")
            return True, extracted_config_dir
        else:
            return False, None
            
    except Exception as e:
        logger.error(f"Failed to fetch configs from license server: {e}")
        logger.error("❌ You do not have a valid license. Please purchase a license to receive updates.")
        return False, None


def _download_and_extract_configs(zip_url: str, config: ComfyUIConfig) -> Optional[str]:
    """
    Download and extract the configs zip file
    
    Args:
        zip_url: URL to download the zip file from
        config: ComfyUI configuration
        
    Returns:
        Path to extracted directory, or None if failed
    """
    try:
        # Download zip to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_zip:
            zip_response = requests.get(zip_url, stream=True)
            zip_response.raise_for_status()
            
            for chunk in zip_response.iter_content(chunk_size=8192):
                tmp_zip.write(chunk)
            
            tmp_zip_path = tmp_zip.name
        
        # Extract to temporary directory
        tmp_dir = tempfile.mkdtemp()
        
        try:
            with zipfile.ZipFile(tmp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(tmp_dir)
            
            # Find CSV files
            found_cn = None
            found_mu = None
            
            for root, dirs, files in os.walk(tmp_dir):
                if os.path.relpath(root, tmp_dir).count(os.sep) >= 6:  # Max depth 6
                    continue
                for file in files:
                    if file.lower() == 'custom_nodes.csv' and not found_cn:
                        found_cn = os.path.join(root, file)
                    elif file.lower() == 'model_urls.csv' and not found_mu:
                        found_mu = os.path.join(root, file)
            
            if not found_cn or not found_mu:
                logger.error("Configs zip did not contain expected CSVs (custom_nodes.csv, model_urls.csv).")
                return None
            
            # Copy CSV files to expected locations
            shutil.copy2(found_cn, config.custom_nodes_csv)
            shutil.copy2(found_mu, config.model_urls_csv)
            
            logger.info(f"Extracted configs to: {tmp_dir}")
            return tmp_dir
            
        finally:
            os.unlink(tmp_zip_path)
            
    except Exception as e:
        logger.error(f"Failed to download and extract configs: {e}")
        return None


def cleanup_extracted_configs(extracted_config_dir: Optional[str], config: ComfyUIConfig) -> None:
    """
    Clean up temporary CSV config files and extracted directory
    
    Args:
        extracted_config_dir: Path to extracted config directory
        config: ComfyUI configuration
    """
    # Only clean up the copied CSV files, not the original extracted ones
    for file_path in [config.custom_nodes_csv, config.model_urls_csv]:
        if os.path.isfile(file_path):
            # Check if this is a copied file (not in the extracted directory)
            if not extracted_config_dir or not file_path.startswith(extracted_config_dir):
                try:
                    os.remove(file_path)
                    logger.info(f"Removed temporary file: {file_path}")
                except Exception as e:
                    logger.warning(f"Failed to remove {file_path}: {e}")
    
    # Clean up the extracted config directory after processing
    if extracted_config_dir and os.path.isdir(extracted_config_dir):
        try:
            shutil.rmtree(extracted_config_dir)
            logger.info(f"Removed temporary directory: {extracted_config_dir}")
        except Exception as e:
            logger.warning(f"Failed to remove {extracted_config_dir}: {e}")
