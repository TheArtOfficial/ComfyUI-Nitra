#!/usr/bin/env python3
"""
Script Runner Utility
Downloads, runs, and cleans up Python scripts from S3 with local testing support
"""

import os
import sys
import json
import requests
import tempfile
import subprocess
import shutil
from typing import List, Dict, Optional, Any
from urllib.parse import urlparse

# Add the setup_modules directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'setup_modules'))

from setup_modules.logging_setup import setup_logging
from setup_modules.config import load_config, setup_environment


class ScriptRunner:
    """Utility class for downloading, running, and cleaning up Python scripts"""
    
    def __init__(self, config=None, access_token=None, configs_url=None):
        """Initialize the script runner
        
        Args:
            config: ComfyUIConfig object (optional)
            access_token: JWT token for API authentication (optional)
            configs_url: Base URL for API endpoints (optional, takes precedence)
        """
        self.logger = setup_logging()
        self.access_token = access_token
        self.temp_dir = None
        self.script_path = None
        
        # Store configs_url directly if provided - no config object needed
        if configs_url:
            self.configs_url = configs_url
            self.config = config  # May be None, that's fine
        else:
            # Load config from environment (requires NITRA_CONFIGS_URL to be set)
            self.config = config or self._load_config()
            self.configs_url = self.config.configs_url if self.config else None
        
    def _load_config(self):
        """Load configuration from environment variables"""
        try:
            setup_environment()
            return load_config()
        except Exception as e:
            self.logger.error(f"Failed to load configuration: {e}")
            return None
    
    def download_script(self, script_name: str, local_test: bool = False) -> bool:
        """
        Download a script from S3 or use local version for testing
        
        Args:
            script_name: Name of the script to download
            local_test: If True, use local script instead of downloading from S3
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Create temporary directory
            self.temp_dir = tempfile.mkdtemp(prefix=f"script_runner_{script_name}_")
            
            if local_test:
                return self._use_local_script(script_name)
            else:
                return self._download_script_from_s3(script_name)
                
        except Exception as e:
            self.logger.error(f"Failed to download script {script_name}: {e}")
            return False
    
    def _use_local_script(self, script_name: str) -> bool:
        """Use local script for testing"""
        try:
            # Map script names to local file paths
            script_mapping = {
                'model_downloads': 'model_downloads.py',
                'sageattention': 'sageattention.py',
                'windows_triton': 'windows_triton.py',
                'workflow_downloader': 'workflow_downloader.py'
            }
            
            if script_name not in script_mapping:
                self.logger.error(f"Unknown script name: {script_name}")
                return False
            
            local_script_path = os.path.join(os.path.dirname(__file__), script_mapping[script_name])
            
            if not os.path.exists(local_script_path):
                self.logger.error(f"Local script not found: {local_script_path}")
                return False
            
            # Copy local script to temp directory
            self.script_path = os.path.join(self.temp_dir, f"{script_name}.py")
            shutil.copy2(local_script_path, self.script_path)
            
            # Make script executable
            os.chmod(self.script_path, 0o755)
            
            self.logger.info(f"Using local script: {local_script_path}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to use local script: {e}")
            return False
    
    def _download_script_from_s3(self, script_name: str) -> bool:
        """Download script from S3 using presigned URLs (like workflows/subgraphs)"""
        try:
            if not self.configs_url:
                self.logger.error("configs_url not available")
                return False
            
            # Use the same pattern as workflows and subgraphs - get presigned URL from API
            api_url = f"{self.configs_url}/scripts/{script_name}/download"
            
            # Use the provided access token or fall back to config token
            token = self.access_token or (getattr(self.config, 'access_token', None) if self.config else None)
            if not token:
                self.logger.error("No access token available for API call")
                return False
                
            headers = {
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            }
            
            response = requests.get(api_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            download_data = response.json()
            download_url = download_data.get('downloadUrl')
            
            if not download_url:
                self.logger.error("No download URL received")
                return False
            
            # Download the script using presigned URL
            self.script_path = os.path.join(self.temp_dir, f"{script_name}.py")
            
            script_response = requests.get(download_url, stream=True, timeout=300)
            script_response.raise_for_status()
            
            with open(self.script_path, 'wb') as f:
                for chunk in script_response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            # Make script executable
            os.chmod(self.script_path, 0o755)
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to download script from S3: {e}")
            return False
    
    def run_script(self, args: List[str] = None) -> Dict[str, Any]:
        """
        Run the downloaded script with the given arguments
        
        Args:
            args: List of arguments to pass to the script
            
        Returns:
            Dictionary containing execution results
        """
        if not self.script_path or not os.path.exists(self.script_path):
            return {
                'success': False,
                'output': '',
                'error': 'Script not available',
                'execution_time': 0
            }
        
        try:
            import time
            start_time = time.time()
            
            # Prepare command - use ComfyUI Python instead of system python3
            import sys
            
            # Use the same Python that's running ComfyUI
            # Note: Don't use -s flag here - it prevents PYTHONPATH from working
            # The -s flag is only for pip operations (see config.py)
            cmd = [sys.executable, self.script_path]
            if args:
                cmd.extend(args)
            
            # Set working directory to the web directory where setup_modules is located
            web_dir = os.path.join(os.path.dirname(__file__))
            
            # Set PYTHONPATH to include the web directory
            env = os.environ.copy()
            if 'PYTHONPATH' in env:
                env['PYTHONPATH'] = f"{web_dir}{os.pathsep}{env['PYTHONPATH']}"
            else:
                env['PYTHONPATH'] = web_dir
            
            # Pass the access token and other environment variables to the script
            if self.access_token:
                env['NITRA_ACCESS_TOKEN'] = self.access_token
            
            # Also set other common environment variables that scripts might need
            if self.configs_url:
                env['NITRA_CONFIGS_URL'] = self.configs_url
            
            # Execute the script from the web directory
            # Use Popen to show real-time output
            import subprocess
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=web_dir,
                env=env,
                bufsize=1,
                universal_newlines=True
            )
            
            # Capture output in real-time
            output_lines = []
            while True:
                output = process.stdout.readline()
                if output == '' and process.poll() is not None:
                    break
                if output and output.strip():  # Only log non-empty lines
                    output_lines.append(output.strip())
                    self.logger.info(output.strip())
            
            # Get return code
            return_code = process.poll()
            
            # Create result object similar to subprocess.run
            class Result:
                def __init__(self, returncode, stdout, stderr):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr
            
            result = Result(
                returncode=return_code,
                stdout='\n'.join(output_lines),
                stderr=''
            )
            
            execution_time = time.time() - start_time
            
            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr,
                'execution_time': execution_time,
                'return_code': result.returncode
            }
            
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'output': '',
                'error': 'Script execution timed out after 5 minutes',
                'execution_time': 300,
                'return_code': -1
            }
        except Exception as e:
            return {
                'success': False,
                'output': '',
                'error': str(e),
                'execution_time': 0,
                'return_code': -1
            }
    
    def cleanup(self):
        """Clean up temporary files and directories"""
        try:
            if self.temp_dir and os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
                self.temp_dir = None
                self.script_path = None
        except Exception as e:
            self.logger.error(f"Failed to cleanup: {e}")
    
    def run_script_with_cleanup(self, script_name: str, args: List[str] = None, local_test: bool = False) -> Dict[str, Any]:
        """
        Complete workflow: download, run, and cleanup a script
        
        Args:
            script_name: Name of the script to run
            args: Arguments to pass to the script
            local_test: If True, use local script instead of downloading from S3
            
        Returns:
            Dictionary containing execution results
        """
        try:
            # Download the script
            if not self.download_script(script_name, local_test):
                return {
                    'success': False,
                    'output': '',
                    'error': f'Failed to download script: {script_name}',
                    'execution_time': 0
                }
            
            # Run the script
            result = self.run_script(args)
            
            return result
            
        finally:
            # Always cleanup
            self.cleanup()


def run_script_via_api(script_name: str, args: List[str] = None, local_test: bool = False, access_token: str = None) -> Dict[str, Any]:
    """
    Run a script via the API (for use in web interfaces)
    
    Args:
        script_name: Name of the script to run
        args: Arguments to pass to the script
        local_test: If True, use local script instead of downloading from S3
        access_token: JWT token for API authentication
        
    Returns:
        Dictionary containing execution results
    """
    logger = setup_logging()
    
    try:
        # Setup environment and load configuration
        setup_environment()
        config = load_config()
        
        # Use provided token or fall back to config token
        token = access_token or getattr(config, 'access_token', None)
        if not token:
            logger.error("No access token provided for API call")
            return {
                'success': False,
                'output': '',
                'error': 'No access token provided',
                'execution_time': 0
            }
        
        # Prepare request data
        request_data = {
            'script_name': script_name,
            'args': args or [],
            'local_test': local_test
        }
        
        # Make API request
        api_url = f"{config.configs_url}/scripts/run"
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        logger.info(f"Running script {script_name} via API...")
        response = requests.post(api_url, headers=headers, json=request_data, timeout=600)
        response.raise_for_status()
        
        result = response.json()
        logger.info(f"Script execution completed: {result.get('success', False)}")
        
        return result
        
    except Exception as e:
        logger.error(f"Failed to run script via API: {e}")
        return {
            'success': False,
            'output': '',
            'error': str(e),
            'execution_time': 0
        }


def main():
    """Main function for script runner"""
    logger = setup_logging()
    
    try:
        if len(sys.argv) < 2:
            logger.error("Usage: python script_runner.py <script_name> [args...] [--local-test]")
            return False
        
        script_name = sys.argv[1]
        args = []
        local_test = False
        
        # Parse arguments
        for arg in sys.argv[2:]:
            if arg == '--local-test':
                local_test = True
            else:
                args.append(arg)
        
        # Create script runner
        runner = ScriptRunner()
        
        # Run script with cleanup
        result = runner.run_script_with_cleanup(script_name, args, local_test)
        
        # Print results
        if result['success']:
            logger.info("Script executed successfully!")
            if result['output']:
                logger.info(f"Output: {result['output']}")
        else:
            logger.error("Script execution failed!")
            if result['error']:
                logger.error(f"Error: {result['error']}")
        
        logger.info(f"Execution time: {result['execution_time']:.2f} seconds")
        
        return result['success']
        
    except Exception as e:
        logger.error(f"Script runner failed: {e}")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
