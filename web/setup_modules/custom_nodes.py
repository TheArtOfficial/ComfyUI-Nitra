"""
Custom node installation and management for ComfyUI setup
"""

import os
import csv
from typing import Optional

from .config import ComfyUIConfig
from .utils import run_command
from .logging_setup import get_logger

logger = get_logger(__name__)


def install_custom_node(repo_url: str, config: ComfyUIConfig) -> bool:
    """
    Install a custom node from a GitHub repo into ComfyUI/custom_nodes
    
    Args:
        repo_url: GitHub repository URL
        config: ComfyUI configuration
        
    Returns:
        True if installation successful, False otherwise
    """
    if not repo_url:
        logger.error("install_custom_node: missing repo url")
        return False
    
    # Extract name from repo URL
    name = os.path.basename(repo_url.rstrip('/'))
    if name.endswith('.git'):
        name = name[:-4]
    
    target_dir = os.path.join(config.app_dir, 'custom_nodes', name)
    custom_nodes_dir = os.path.join(config.app_dir, 'custom_nodes')
    
    os.makedirs(custom_nodes_dir, exist_ok=True)
    
    git_dir = os.path.join(target_dir, '.git')
    
    # Track whether we need to install requirements
    should_install_requirements = False
    
    if not os.path.isdir(git_dir):
        logger.info(f"Installing custom node {name}...")
        result = run_command(['git', 'clone', repo_url, target_dir], log_output=False)
        if result.returncode != 0:
            logger.error(f"Failed to clone {repo_url}")
            return False
        logger.info(f"Successfully installed custom node {name}")
        should_install_requirements = True  # Always install requirements for new nodes
    else:
        if config.update:
            logger.info(f"Updating custom node {name}...")
            run_command(['git', 'fetch', '--all', '--prune'], cwd=target_dir, log_output=False)
            run_command(['git', 'pull', '--ff-only'], cwd=target_dir, log_output=False)
            logger.info(f"Successfully updated custom node {name}")
            should_install_requirements = True  # Install requirements when updating
        else:
            should_install_requirements = False  # Skip requirements for existing nodes when not updating
    
    # Install node-specific requirements only when needed
    if should_install_requirements:
        _install_node_requirements(target_dir, name, config)
    
    return True


def install_custom_nodes_from_csv(csv_file: str, config: ComfyUIConfig) -> None:
    """
    Bulk install custom nodes from a CSV file
    
    Args:
        csv_file: Path to CSV file containing repository URLs
        config: ComfyUI configuration
    """
    if not os.path.isfile(csv_file):
        logger.warning(f"Custom nodes CSV file not found: {csv_file}")
        return
    
    # Installing custom nodes from CSV
    
    with open(csv_file, 'r', newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            
            url = row[0].strip().strip('"')
            
            # Skip blanks and comments
            if not url or url.startswith('#'):
                continue
            
            install_custom_node(url, config)


def setup_hunyuan3d_wrapper(config: ComfyUIConfig) -> None:
    """
    Setup Hunyuan3DWrapper native components if UPDATE is enabled
    
    Args:
        config: ComfyUI configuration
    """
    if not config.update:
        return
    
    h3d_dir = os.path.join(config.app_dir, 'custom_nodes', 'ComfyUI-Hunyuan3DWrapper')
    if not os.path.isdir(h3d_dir):
        return
    
    # Setup custom_rasterizer
    custom_rast_dir = os.path.join(h3d_dir, 'hy3dgen', 'texgen', 'custom_rasterizer')
    if os.path.isdir(custom_rast_dir):
        try:
            # Don't use -s flag for running scripts - only for pip
            run_command([config.venv_py, 'setup.py', 'install'], cwd=custom_rast_dir, log_output=False)
        except Exception as e:
            logger.warning(f"Failed to build custom_rasterizer: {e}")
    
    # Setup differentiable_renderer
    diff_render_dir = os.path.join(h3d_dir, 'differentiable_renderer')
    if os.path.isdir(diff_render_dir):
        try:
            # Don't use -s flag for running scripts - only for pip
            run_command([config.venv_py, 'setup.py', 'build_ext', '--inplace'], cwd=diff_render_dir, log_output=False)
        except Exception as e:
            logger.warning(f"Failed to build differentiable_renderer: {e}")


def _install_node_requirements(target_dir: str, name: str, config: ComfyUIConfig) -> None:
    """
    Install requirements for a custom node
    
    Args:
        target_dir: Directory containing the custom node
        name: Name of the custom node
        config: ComfyUI configuration
    """
    requirements_files = ['.requirements.txt', 'requirements.txt']
    for req_file in requirements_files:
        req_path = os.path.join(target_dir, req_file)
        if os.path.isfile(req_path):
            cmd = config.venv_pip + ['install', '--no-warn-script-location', '-r', req_path, '--quiet']
            result = run_command(cmd, log_output=False)
            if result.returncode != 0:
                logger.warning(f"Failed to install requirements for {name}")
            break
