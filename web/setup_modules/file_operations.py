"""
File synchronization and directory operations for ComfyUI setup
"""

import os
import json
import shutil
from typing import Optional

from .config import ComfyUIConfig
from .logging_setup import get_logger

logger = get_logger(__name__)


def sync_files(src_dir: str, dst_dir: str, overwrite: bool = False) -> None:
    """
    Sync files from src to dst directory
    
    Args:
        src_dir: Source directory
        dst_dir: Destination directory  
        overwrite: If True, copy and overwrite existing files.
                  If False, add new files only, leave existing untouched.
    """
    if not os.path.isdir(src_dir):
        logger.warning(f"Source directory does not exist: {src_dir}")
        return
    
    os.makedirs(dst_dir, exist_ok=True)
    
    mode = "overwrite existing files, keep user extras" if overwrite else "add-only; leave existing untouched"
    logger.info(f"Syncing {src_dir} -> {dst_dir} ({mode})...")
    
    files_synced = 0
    for root, dirs, files in os.walk(src_dir):
        # Skip .git directories
        dirs[:] = [d for d in dirs if d != '.git']
        
        rel_dir = os.path.relpath(root, src_dir)
        if rel_dir == '.':
            target_dir = dst_dir
        else:
            target_dir = os.path.join(dst_dir, rel_dir)
        
        os.makedirs(target_dir, exist_ok=True)
        
        for file in files:
            src_file = os.path.join(root, file)
            dst_file = os.path.join(target_dir, file)
            
            if overwrite or not os.path.exists(dst_file):
                shutil.copy2(src_file, dst_file)
                files_synced += 1
                logger.debug(f"Synced: {os.path.relpath(dst_file, dst_dir)}")
    
    logger.info(f"File sync completed: {files_synced} files synced")


def sync_subgraphs(config: ComfyUIConfig, extracted_config_dir: Optional[str]) -> None:
    """
    Sync subgraphs from various sources to user directory
    
    Args:
        config: ComfyUI configuration
        extracted_config_dir: Path to extracted config directory (if any)
    """
    src_subgraphs_dir = "/usr/local/bin/subgraphs"  # Default path
    dst_subgraphs_dir = os.path.join(config.app_dir, 'user', 'default', 'subgraphs')
    
    # Determine source directory based on configuration
    if config.local_demo:
        demo_subgraphs = os.path.join(config.comfy_dir, 'demo', 'subgraphs')
        if os.path.isdir(demo_subgraphs):
            src_subgraphs_dir = demo_subgraphs
    elif extracted_config_dir:
        # Look for subgraphs in extracted config
        for root, dirs, files in os.walk(extracted_config_dir):
            if os.path.relpath(root, extracted_config_dir).count(os.sep) >= 6:
                continue
            if 'subgraphs' in dirs:
                src_subgraphs_dir = os.path.join(root, 'subgraphs')
                break
    
    if os.path.isdir(src_subgraphs_dir):
        logger.info(f"Using subgraphs from: {src_subgraphs_dir}")
        sync_files(src_subgraphs_dir, dst_subgraphs_dir, overwrite=config.update)
    else:
        logger.info(f"No subgraphs found at: {src_subgraphs_dir}")


def sync_workflows(config: ComfyUIConfig, extracted_config_dir: Optional[str]) -> None:
    """
    Sync workflows from various sources to user directory
    
    Args:
        config: ComfyUI configuration
        extracted_config_dir: Path to extracted config directory (if any)
    """
    src_workflows_dir = "/usr/local/bin/workflows"  # Default path
    dst_workflows_dir = os.path.join(config.app_dir, 'user', 'default', 'workflows')
    
    # Determine source directory based on configuration
    if config.local_demo:
        demo_workflows = os.path.join(config.comfy_dir, 'demo', 'workflows')
        if os.path.isdir(demo_workflows):
            src_workflows_dir = demo_workflows
    elif extracted_config_dir:
        # Look for workflows in extracted config
        for root, dirs, files in os.walk(extracted_config_dir):
            if os.path.relpath(root, extracted_config_dir).count(os.sep) >= 6:
                continue
            if 'workflows' in dirs:
                src_workflows_dir = os.path.join(root, 'workflows')
                break
    
    if os.path.isdir(src_workflows_dir):
        logger.info(f"Using workflows from: {src_workflows_dir}")
        sync_files(src_workflows_dir, dst_workflows_dir, overwrite=config.update)
    else:
        logger.info(f"No workflows found at: {src_workflows_dir}")


def setup_comfy_settings(config: ComfyUIConfig) -> None:
    """
    Ensure ComfyUI user setting VHS.LatentPreview is set to true
    
    Args:
        config: ComfyUI configuration
    """
    settings_path = os.path.join(config.app_dir, 'user', 'default', 'comfy.settings.json')
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    
    # Load existing settings or create new
    settings = {}
    if os.path.exists(settings_path):
        try:
            with open(settings_path, 'r') as f:
                settings = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load existing settings: {e}")
            settings = {}
    
    # Set VHS.LatentPreview to True
    settings["VHS.LatentPreview"] = True
    
    # Write back to file
    try:
        with open(settings_path, 'w') as f:
            json.dump(settings, f, indent=4)
        logger.info(f"Updated ComfyUI settings: {settings_path}")
    except Exception as e:
        logger.error(f"Failed to update ComfyUI settings: {e}")


def find_model_csv_in_extracted_config(extracted_config_dir: str, default_csv_path: str) -> str:
    """
    Find model_urls.csv in extracted config directory
    
    Args:
        extracted_config_dir: Path to extracted config directory
        default_csv_path: Default CSV path to fall back to
        
    Returns:
        Path to model CSV file
    """
    if not extracted_config_dir:
        return default_csv_path
    
    for root, dirs, files in os.walk(extracted_config_dir):
        if os.path.relpath(root, extracted_config_dir).count(os.sep) >= 6:
            continue
        for file in files:
            if file.lower() == 'model_urls.csv':
                extracted_csv_path = os.path.join(root, file)
                logger.info(f"Found model_urls.csv in extracted config: {extracted_csv_path}")
                return extracted_csv_path
    
    return default_csv_path


def cleanup_csv_files(config: ComfyUIConfig) -> None:
    """
    Clean up temporary CSV files
    
    Args:
        config: ComfyUI configuration
    """
    csv_files = [config.custom_nodes_csv, config.model_urls_csv]
    
    for csv_file in csv_files:
        if os.path.isfile(csv_file):
            try:
                os.remove(csv_file)
                logger.info(f"Removed temporary CSV file: {csv_file}")
            except Exception as e:
                logger.warning(f"Failed to remove {csv_file}: {e}")
