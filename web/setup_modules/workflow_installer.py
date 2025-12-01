"""
Workflow and subgraph installation functionality for ComfyUI setup
"""

import os
import json
import requests
from typing import List, Dict, Optional
from urllib.parse import urlparse

from .config import ComfyUIConfig
from .utils import validate_path_security
from .logging_setup import get_logger

logger = get_logger(__name__)


def install_workflows(workflow_ids: List[str], config: ComfyUIConfig) -> bool:
    """
    Install workflows and their dependencies
    
    Args:
        workflow_ids: List of workflow IDs to install
        config: ComfyUI configuration
        
    Returns:
        True if installation successful, False otherwise
    """
    if not workflow_ids:
        logger.warning("No workflow IDs provided for installation")
        return True
    
    logger.info(f"Installing {len(workflow_ids)} workflows...")
    
    try:
        # Get workflow details from API
        workflows_data = []
        for workflow_id in workflow_ids:
            workflow_data = _fetch_workflow_details(workflow_id, config)
            if workflow_data:
                workflows_data.append(workflow_data)
            else:
                logger.error(f"Failed to fetch details for workflow {workflow_id}")
                return False
        
        # Install workflows
        for workflow_data in workflows_data:
            if not _install_single_workflow(workflow_data, config):
                logger.error(f"Failed to install workflow {workflow_data.get('id', 'unknown')}")
                return False
        
        # Install dependencies (subgraphs and custom nodes)
        for workflow_data in workflows_data:
            if not _install_workflow_dependencies(workflow_data, config):
                logger.error(f"Failed to install dependencies for workflow {workflow_data.get('id', 'unknown')}")
                return False
        
        logger.info("All workflows installed successfully")
        return True
        
    except Exception as e:
        logger.error(f"Error installing workflows: {e}")
        return False


def _fetch_workflow_details(workflow_id: str, config: ComfyUIConfig) -> Optional[Dict]:
    """Fetch workflow details from the API"""
    try:
        api_url = f"{config.configs_url}/workflows/{workflow_id}"
        headers = {
            'Authorization': f'Bearer {config.access_token}',
            'Content-Type': 'application/json',
            'X-User-Email': config.user_email
        }
        
        response = requests.get(api_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        return response.json()
        
    except Exception as e:
        logger.error(f"Failed to fetch workflow {workflow_id}: {e}")
        return None


def _install_single_workflow(workflow_data: Dict, config: ComfyUIConfig) -> bool:
    """Install a single workflow file"""
    try:
        workflow_id = workflow_data.get('id')
        workflow_name = workflow_data.get('name', 'Unnamed Workflow')
        workflow_file_url = workflow_data.get('fileUrl')
        
        if not workflow_file_url:
            logger.error(f"No file URL for workflow {workflow_id}")
            return False
        
        # Create workflows directory
        workflows_dir = os.path.join(config.app_dir, 'user', 'default', 'workflows')
        os.makedirs(workflows_dir, exist_ok=True)
        
        # Download workflow file
        workflow_filename = f"{workflow_name.replace(' ', '_')}_{workflow_id}.json"
        workflow_path = os.path.join(workflows_dir, workflow_filename)
        
        logger.info(f"Downloading workflow: {workflow_name}")
        if _download_file(workflow_file_url, workflow_path, config):
            logger.info(f"[OK] Workflow installed: {workflow_filename}")
            return True
        else:
            logger.error(f"[ERROR] Failed to download workflow: {workflow_name}")
            return False
            
    except Exception as e:
        logger.error(f"Error installing workflow: {e}")
        return False


def _install_workflow_dependencies(workflow_data: Dict, config: ComfyUIConfig) -> bool:
    """Install workflow dependencies (subgraphs and custom nodes)"""
    try:
        dependencies = workflow_data.get('dependencies', [])
        if not dependencies:
            logger.info("No dependencies to install")
            return True
        
        logger.info(f"Installing {len(dependencies)} dependencies...")
        
        # Install subgraphs
        subgraphs = [dep for dep in dependencies if dep.get('type') == 'subgraph']
        for subgraph in subgraphs:
            if not _install_subgraph(subgraph, config):
                logger.error(f"Failed to install subgraph: {subgraph.get('name', 'unknown')}")
                return False
        
        # Install custom nodes
        custom_nodes = [dep for dep in dependencies if dep.get('type') == 'custom_node']
        for custom_node in custom_nodes:
            if not _install_custom_node(custom_node, config):
                logger.error(f"Failed to install custom node: {custom_node.get('name', 'unknown')}")
                return False
        
        return True
        
    except Exception as e:
        logger.error(f"Error installing dependencies: {e}")
        return False


def _install_subgraph(subgraph_data: Dict, config: ComfyUIConfig) -> bool:
    """Install a subgraph file"""
    try:
        subgraph_name = subgraph_data.get('name', 'Unnamed Subgraph')
        subgraph_file_url = subgraph_data.get('fileUrl')
        
        if not subgraph_file_url:
            logger.error(f"No file URL for subgraph: {subgraph_name}")
            return False
        
        # Create subgraphs directory
        subgraphs_dir = os.path.join(config.app_dir, 'user', 'default', 'subgraphs')
        os.makedirs(subgraphs_dir, exist_ok=True)
        
        # Use subgraph name for filename as requested, ensuring .json extension
        clean_name = subgraph_name.replace(' ', '_')
        if not clean_name.lower().endswith('.json'):
            subgraph_filename = f"{clean_name}.json"
        else:
            subgraph_filename = clean_name
            
        subgraph_path = os.path.join(subgraphs_dir, subgraph_filename)
        
        logger.info(f"Downloading subgraph: {subgraph_name} -> {subgraph_filename}")
        if _download_file(subgraph_file_url, subgraph_path, config):
            logger.info(f"[OK] Subgraph installed: {subgraph_filename}")
            return True
        else:
            logger.error(f"[ERROR] Failed to download subgraph: {subgraph_name}")
            return False
            
    except Exception as e:
        logger.error(f"Error installing subgraph: {e}")
        return False


def _install_custom_node(custom_node_data: Dict, config: ComfyUIConfig) -> bool:
    """Install a custom node"""
    try:
        custom_node_name = custom_node_data.get('name', 'Unnamed Custom Node')
        git_repo = custom_node_data.get('gitRepo')
        
        if not git_repo:
            logger.error(f"No git repository for custom node: {custom_node_name}")
            return False
        
        # Create custom nodes directory
        custom_nodes_dir = os.path.join(config.comfy_dir, 'custom_nodes')
        os.makedirs(custom_nodes_dir, exist_ok=True)
        
        # Extract repository name from git URL
        repo_name = os.path.basename(git_repo.replace('.git', ''))
        node_dir = os.path.join(custom_nodes_dir, repo_name)
        
        # Check if already installed
        if os.path.exists(node_dir):
            logger.info(f"Custom node already exists: {custom_node_name}")
            return True
        
        logger.info(f"Installing custom node: {custom_node_name}")
        logger.info(f"Git repository: {git_repo}")
        
        # Clone the repository
        import subprocess
        result = subprocess.run([
            'git', 'clone', git_repo, node_dir
        ], capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            logger.info(f"[OK] Custom node installed: {custom_node_name}")
            return True
        else:
            logger.error(f"[ERROR] Failed to install custom node: {custom_node_name}")
            logger.error(f"Git error: {result.stderr}")
            return False
            
    except Exception as e:
        logger.error(f"Error installing custom node: {e}")
        return False


def _download_file(url: str, dest_path: str, config: ComfyUIConfig) -> bool:
    """Download a file from URL to destination path"""
    try:
        headers = {}
        if config.hf_token and 'huggingface.co' in url:
            headers['Authorization'] = f'Bearer {config.hf_token}'
        
        response = requests.get(url, headers=headers, stream=True, timeout=300)
        response.raise_for_status()
        
        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        logger.info(f"Downloaded: {os.path.basename(dest_path)}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to download {url}: {e}")
        return False


def install_models_by_ids(model_ids: List[str], config: ComfyUIConfig) -> bool:
    """
    Install models by their IDs
    
    Args:
        model_ids: List of model IDs to install
        config: ComfyUI configuration
        
    Returns:
        True if installation successful, False otherwise
    """
    if not model_ids:
        logger.warning("No model IDs provided for installation")
        return True
    
    logger.info(f"Installing {len(model_ids)} models...")
    
    try:
        # Get model details from API
        models_data = []
        for model_id in model_ids:
            model_data = _fetch_model_details(model_id, config)
            if model_data:
                models_data.append(model_data)
            else:
                logger.error(f"Failed to fetch details for model {model_id}")
                return False
        
        # Install models
        for model_data in models_data:
            if not _install_single_model(model_data, config):
                logger.error(f"Failed to install model {model_data.get('id', 'unknown')}")
                return False
        
        logger.info("All models installed successfully")
        return True
        
    except Exception as e:
        logger.error(f"Error installing models: {e}")
        return False


def _fetch_model_details(model_id: str, config: ComfyUIConfig) -> Optional[Dict]:
    """Fetch model details from the API"""
    try:
        api_url = f"{config.configs_url}/models/{model_id}"
        headers = {
            'Authorization': f'Bearer {config.access_token}',
            'Content-Type': 'application/json',
            'X-User-Email': config.user_email
        }
        
        response = requests.get(api_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        return response.json()
        
    except Exception as e:
        logger.error(f"Failed to fetch model {model_id}: {e}")
        return None


def _install_single_model(model_data: Dict, config: ComfyUIConfig) -> bool:
    """Install a single model file"""
    try:
        model_id = model_data.get('id')
        model_name = model_data.get('modelName', 'Unnamed Model')
        model_url = model_data.get('modelUrl')
        install_folder = model_data.get('installFolder', 'diffusion_models')
        
        if not model_url:
            logger.error(f"No model URL for model {model_id}")
            return False
        
        # Create models directory
        models_dir = os.path.join(config.app_dir, 'models', install_folder)
        os.makedirs(models_dir, exist_ok=True)
        
        # Determine output filename
        if model_name:
            # Use the model name from database
            output_filename = f"{model_name}.safetensors"
        else:
            # Fall back to URL filename
            url_path = urlparse(model_url).path
            output_filename = os.path.basename(url_path)
        
        model_path = os.path.join(models_dir, output_filename)
        
        logger.info(f"Downloading model: {model_name}")
        logger.info(f"Install folder: {install_folder}")
        
        if _download_file(model_url, model_path, config):
            logger.info(f"[OK] Model installed: {output_filename}")
            return True
        else:
            logger.error(f"[ERROR] Failed to download model: {model_name}")
            return False
            
    except Exception as e:
        logger.error(f"Error installing model: {e}")
        return False
