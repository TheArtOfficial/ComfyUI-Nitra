"""
Configuration management for ComfyUI setup
"""

import os
import json
import unicodedata
from typing import Optional, List


class ComfyUIConfig:
    """Configuration class for ComfyUI setup"""
    
    def __init__(self):
        # Basic paths
        # For Python embedded, we need to detect the correct ComfyUI directory
        # The embedded Python is in ComfyUI_windows_portable, but ComfyUI is in ComfyUI_windows_portable/ComfyUI
        comfy_dir_env = os.environ.get('COMFY_DIR')
        if comfy_dir_env:
            self.comfy_dir = comfy_dir_env
            print(f"[CONFIG] Using COMFY_DIR from environment: {self.comfy_dir}")
        else:
            # Fallback: try to detect ComfyUI directory by looking for main.py
            # Scripts run from web directory, so we need to walk up to find ComfyUI root
            cwd = os.getcwd()
            print(f"[CONFIG] COMFY_DIR not set, detecting from cwd: {cwd}")
            
            # Walk up from current directory to find main.py
            search_dir = cwd
            found = False
            for _ in range(5):  # Limit search depth
                if os.path.exists(os.path.join(search_dir, 'main.py')):
                    # Found ComfyUI directory
                    self.comfy_dir = search_dir
                    found = True
                    print(f"[CONFIG] Found ComfyUI directory: {self.comfy_dir}")
                    break
                parent_dir = os.path.dirname(search_dir)
                if parent_dir == search_dir:  # Reached root
                    break
                search_dir = parent_dir
            
            if not found:
                # Check if we're in python_embeded directory and ComfyUI is a subdirectory
                if os.path.exists(os.path.join(cwd, 'ComfyUI', 'main.py')):
                    self.comfy_dir = os.path.join(cwd, 'ComfyUI')
                    print(f"[CONFIG] Found ComfyUI as subdirectory: {self.comfy_dir}")
                else:
                    # Last resort: use cwd
                    self.comfy_dir = cwd
                    print(f"[CONFIG] WARNING: Could not find main.py, using cwd: {self.comfy_dir}")
        
        self.app_dir = self.comfy_dir
        self.venv_dir = os.environ.get('VENV_DIR', os.path.join(self.comfy_dir, 'venv'))
        # Determine models root directory, respecting extra model paths when configured
        self.models_root_dir = self._detect_models_root_dir()
        print(f"[CONFIG] Models will be saved to: {os.path.join(self.models_root_dir, 'models')}")
        
        # API configuration
        # Note: NITRA_CONFIGS_URL MUST be set by the server before running scripts
        # No fallback - fail fast if not configured correctly
        self.configs_url = os.environ.get('NITRA_CONFIGS_URL')
        if not self.configs_url:
            raise ValueError("NITRA_CONFIGS_URL environment variable must be set")
        
        self.access_token = os.environ.get('NITRA_ACCESS_TOKEN', '')
        self.user_id = os.environ.get('NITRA_USER_ID', '')
        self.user_email = os.environ.get('NITRA_USER_EMAIL', '')
        
        # Use the current Python executable (like ComfyUI Manager does)
        import sys
        self.venv_py = sys.executable
        
        # Detect embedded Python (like ComfyUI Manager does)
        self.is_embedded = 'python_embeded' in sys.executable.lower()
        
        # Use python -m pip with -s flag for embedded Python
        # The -s flag prevents site packages from being added to sys.path
        if self.is_embedded:
            self.venv_pip = [sys.executable, '-s', '-m', 'pip']
        else:
            self.venv_pip = [sys.executable, '-m', 'pip']
        
        # Torch index URL for package installations
        self.torch_index_url = os.environ.get('TORCH_INDEX_URL', 'https://download.pytorch.org/whl/cu128')
        
        # Update options
        self.update = os.environ.get('UPDATE', 'false').lower() == 'true'
        self.deep_update = os.environ.get('DEEP_UPDATE', 'false').lower() == 'true'
        
        # HuggingFace token
        self.hf_token = os.environ.get('HF_TOKEN', '')
        
        # Installation options
        self.install_models = os.environ.get('INSTALL_MODELS', 'false').lower() == 'true'
        self.install_custom_nodes = os.environ.get('INSTALL_CUSTOM_NODES', 'false').lower() == 'true'
        self.install_workflows = os.environ.get('INSTALL_WORKFLOWS', 'false').lower() == 'true'
        
        # SageAttention options
        self.sage2 = os.environ.get('SAGE2', 'false').lower() == 'true'
        
        # Nitra specific options
        self.aolabs_run = os.environ.get('NITRA_RUN', 'false').lower() == 'true'
        
        # File paths
        self.custom_nodes_csv = os.path.join(self.comfy_dir, 'custom_nodes.csv')
        self.model_urls_csv = os.path.join(self.comfy_dir, 'model_urls.csv')
        
        # Parse update options from environment
        self._parse_update_options()

    def _detect_models_root_dir(self) -> str:
        """
        Determine the base directory where models should be installed.

        - If the user has configured an extra model path in nitra config.toml and it
          exists on disk, use that as the root.
        - Otherwise, fall back to the standard ComfyUI directory.
        """
        # Default to Comfy root unless we positively find a valid extra model path
        default_root = self.comfy_dir

        try:
            # nitra config lives under user/default/nitra/config.toml relative to Comfy root
            config_path = os.path.join(self.comfy_dir, 'user', 'default', 'nitra', 'config.toml')
            if not os.path.exists(config_path):
                return default_root

            extra_paths: List[str] = []

            # Try tomllib / toml first for robust parsing (same behavior as server)
            data = None
            try:
                try:
                    import tomllib  # type: ignore[attr-defined]
                except Exception:
                    tomllib = None  # type: ignore[assignment]

                if tomllib is not None:  # type: ignore[truthy-function]
                    with open(config_path, 'rb') as f:
                        data = tomllib.load(f)
                else:
                    import importlib

                    try:
                        toml = importlib.import_module('toml')
                        with open(config_path, 'r', encoding='utf-8') as f:
                            data = toml.load(f)
                    except Exception:
                        data = None
            except Exception:
                data = None

            if isinstance(data, dict):
                raw_paths = data.get('extra_model_paths')
                if isinstance(raw_paths, list):
                    extra_paths = [str(p).strip() for p in raw_paths if str(p).strip()]

            # If structured parse failed, fall back to a minimal line-based parse
            if not extra_paths:
                try:
                    with open(config_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if not line or line.startswith('#'):
                                continue
                            if line.startswith('extra_model_paths'):
                                start = line.find('[')
                                end = line.rfind(']')
                                if start != -1 and end != -1 and end > start:
                                    inner = line[start + 1 : end]
                                    items = [
                                        s.strip().strip('"')
                                        for s in inner.split(',')
                                        if s.strip()
                                    ]
                                    extra_paths = [p for p in items if p]
                                break
                except Exception:
                    # If we fail to parse, just fall back to default_root
                    return default_root

            # Choose the first valid, existing directory as models root
            for candidate in extra_paths:
                # Ignore blanks
                if not candidate:
                    continue

                # Strip common Unicode control characters that can sneak in from
                # copy-pasted Windows paths (e.g., U+202A direction marks)
                try:
                    cleaned = "".join(
                        ch for ch in candidate
                        if unicodedata.category(ch) != "Cf"
                    )
                except Exception:
                    cleaned = candidate

                cleaned = cleaned.strip()
                if not cleaned:
                    continue

                # Expand user/home references
                path = os.path.expanduser(cleaned)

                # We treat non-existent paths as "not configured"
                if not os.path.isdir(path):
                    continue

                # For extra model roots we only ensure it's a directory on disk; this is
                # a user-chosen absolute base location.
                return path

        except Exception:
            # Any failure should gracefully fall back to default_root
            pass

        return default_root
    
    def _parse_update_options(self):
        """Parse update options from environment variables"""
        update_options_str = os.environ.get('NITRA_UPDATE_OPTIONS', '{}')
        try:
            update_options = json.loads(update_options_str)
            
            # Extract workflow and model IDs
            self.workflow_ids = update_options.get('workflow_ids', [])
            self.model_ids = update_options.get('model_ids', [])
            
            # Extract optimizer installation options
            self.install_windows_triton = update_options.get('install_windows_triton', False)
            self.install_sageattention = update_options.get('install_sageattention', False)
            
            # Override installation flags based on options
            if self.workflow_ids:
                self.install_workflows = True
            if self.model_ids:
                self.install_models = True
                
        except (json.JSONDecodeError, TypeError):
            self.workflow_ids = []
            self.model_ids = []


def load_config() -> ComfyUIConfig:
    """Load ComfyUI configuration from environment variables"""
    return ComfyUIConfig()


def log_configuration(config: ComfyUIConfig, logger) -> None:
    """Log the current configuration"""
    logger.info("ComfyUI Configuration:")
    logger.info(f"  ComfyUI Directory: {config.comfy_dir}")
    logger.info(f"  App Directory: {config.app_dir}")
    logger.info(f"  Virtual Environment: {config.venv_dir}")
    logger.info(f"  Python Executable: {config.venv_py}")
    logger.info(f"  Embedded Python: {config.is_embedded}")
    logger.info(f"  Configs URL: {config.configs_url}")
    logger.info(f"  User ID: {config.user_id}")
    logger.info(f"  User Email: {config.user_email}")
    logger.info(f"  Install Models: {config.install_models}")
    logger.info(f"  Install Custom Nodes: {config.install_custom_nodes}")
    logger.info(f"  Install Workflows: {config.install_workflows}")
    logger.info(f"  Workflow IDs: {config.workflow_ids}")
    logger.info(f"  Model IDs: {config.model_ids}")
    logger.info(f"  Sage2: {config.sage2}")
    logger.info(f"  Nitra Run: {config.aolabs_run}")


def setup_environment() -> None:
    """Setup environment variables and paths"""
    # Ensure required environment variables are set
    if not os.environ.get('COMFY_DIR'):
        os.environ['COMFY_DIR'] = os.getcwd()
    
    if not os.environ.get('VENV_DIR'):
        comfy_dir = os.environ.get('COMFY_DIR', os.getcwd())
        os.environ['VENV_DIR'] = os.path.join(comfy_dir, 'venv')
