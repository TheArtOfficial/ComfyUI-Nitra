#!/usr/bin/env python3
"""
Package Installer for Nitra Optimizer
Handles installation of pytorch, sageattention, onnxruntime-gpu, and triton-windows
"""

import os
import sys
import json
import subprocess
import time
import logging
import platform
import re
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

import requests
from packaging import version as pkg_version

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _verify_prerequisites():
    """Ensure the user still has access before running installers."""
    access_token = os.environ.get('NITRA_ACCESS_TOKEN')
    user_id = os.environ.get('NITRA_USER_ID')
    user_email = os.environ.get('NITRA_USER_EMAIL') or 'unknown@example.com'
    device_token = os.environ.get('NITRA_DEVICE_TOKEN')
    fingerprint_hash = os.environ.get('NITRA_DEVICE_FINGERPRINT')
    website_url = (os.environ.get('NITRA_WEBSITE_URL') or 'https://app.nitralabs.ai').rstrip('/')
    if not access_token or not user_id:
        raise RuntimeError("Missing Nitra authentication context. Please sign in again.")
    if not device_token or not fingerprint_hash:
        raise RuntimeError("Device registration missing. Register this machine from the Nitra panel before installing packages.")

    require_subscription = os.environ.get('NITRA_REQUIRE_SUBSCRIPTION', 'true').strip().lower() not in {'false', '0', 'no'}
    if require_subscription:
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        }
        subscription_resp = requests.post(
            f'{website_url}/api/subscription-check',
            headers=headers,
            json={'userId': user_id},
            timeout=30,
        )
        if subscription_resp.status_code != 200:
            raise RuntimeError("Unable to verify subscription with Nitra servers. Try again in a moment.")
        payload = subscription_resp.json()
        if not payload.get('has_paid_subscription'):
            raise RuntimeError("An active subscription is required to install this package.")

    device_headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
        'X-User-Email': user_email,
    }
    if device_token:
        device_headers['X-Device-Token'] = device_token
    if fingerprint_hash:
        device_headers['X-Device-Fingerprint'] = fingerprint_hash

    device_resp = requests.get(
        f'{website_url}/api/device/slots',
        headers=device_headers,
        timeout=30,
    )
    if device_resp.status_code == 401:
        raise RuntimeError("Nitra authentication expired. Please log in again.")
    if device_resp.status_code >= 400:
        raise RuntimeError("Unable to verify device registration with Nitra servers. Please try again later.")

    devices = device_resp.json().get('devices') or []
    for device in devices:
        if device.get('fingerprintHash') == fingerprint_hash:
            return

    raise RuntimeError("This machine is not registered or was removed. Register it in the Nitra device settings.")


def _resolve_cuda_versions(raw_value: Optional[str]) -> Tuple[str, str]:
    """Return (cuda_label, dotted_version) from config input."""
    default_version = "12.8"
    if not raw_value:
        cleaned = default_version
    else:
        cleaned = str(raw_value).strip()
    # Remove common prefixes/operators
    for token in ("==", ">=", "<=", "~=", "cuda", "CUDA", "cu"):
        cleaned = cleaned.replace(token, "")
    cleaned = cleaned.strip()
    if not cleaned:
        cleaned = default_version

    digits_only = "".join(ch for ch in cleaned if ch.isdigit())
    dotted_version = cleaned if "." in cleaned else ""

    if not dotted_version:
        if len(digits_only) >= 2:
            major = digits_only[:-1]
            minor = digits_only[-1]
        else:
            major = digits_only or "12"
            minor = "8"
        try:
            dotted_version = f"{int(major)}.{minor}"
        except ValueError:
            dotted_version = default_version

    if not digits_only:
        digits_only = dotted_version.replace(".", "")

    cuda_label = f"cu{digits_only}"
    return cuda_label, dotted_version


def _upgrade_cuda_toolkit(target_version: Optional[str]) -> Dict[str, Any]:
    """Install or upgrade the CUDA toolkit on Linux and Windows hosts."""
    os_name = platform.system().lower()
    if os_name not in ['linux', 'windows']:
        return {
            'success': False,
            'error': f'Automatic CUDA toolkit management is not supported on {os_name}.'
        }

    normalized_target = None
    if target_version:
        try:
            _, normalized_target = _resolve_cuda_versions(target_version)
        except Exception:
            normalized_target = target_version.strip()

    print("\n" + "=" * 80)
    print("NITRA: Preparing CUDA Toolkit environment")
    print("=" * 80)
    print(f"Requested CUDA toolkit: {normalized_target or 'Latest available'}")

    # Check currently installed version
    current_cuda_version = None
    if os_name == 'linux':
        nvcc_check = subprocess.run(['which', 'nvcc'], capture_output=True, text=True)
    else:  # Windows
        # Use 'where' command on Windows
        nvcc_check = subprocess.run(['where', 'nvcc'], capture_output=True, text=True, shell=True)

    if nvcc_check.returncode == 0:
        nvcc_version = subprocess.run(['nvcc', '--version'], capture_output=True, text=True)
        if nvcc_version.returncode == 0:
            print("Current CUDA Toolkit:")
            print(nvcc_version.stdout)
            match = re.search(r'release (\d+\.\d+)', nvcc_version.stdout)
            if match:
                current_cuda_version = match.group(1)
                print(f"Detected installed CUDA toolkit: {current_cuda_version}")

    if normalized_target and current_cuda_version == normalized_target:
        print(f"✓ CUDA toolkit {current_cuda_version} already matches requested version.")
        return {
            'success': True,
            'message': f"CUDA toolkit {current_cuda_version} already installed."
        }

    if os_name == 'windows':
        print("\nInstalling CUDA Toolkit on Windows via winget...")
        print("Note: This process may prompt for User Account Control (UAC) permissions.")
        print("Please accept any prompts to continue.")
        
        # Check for winget availability
        try:
            subprocess.run(['winget', '--version'], check=True, capture_output=True, shell=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("⚠ winget not found in PATH.")
            return {
                'success': False,
                'error': 'winget not found. Please install App Installer from Microsoft Store or install CUDA manually: https://developer.nvidia.com/cuda-toolkit-archive'
            }

        # Construct winget command
        # ID: Nvidia.CUDA
        cmd = ['winget', 'install', '-e', '--id', 'Nvidia.CUDA', '--silent', '--force', '--accept-package-agreements', '--accept-source-agreements']
        
        if normalized_target:
            cmd.extend(['--version', normalized_target])
            print(f"Target version: {normalized_target}")
        else:
            print("Target version: Latest")

        print(f"Running command: {' '.join(cmd)}")
        
        # Run winget
        # shell=True is often needed on Windows for cmd built-ins, but winget is an exe.
        # However, some environments need shell=True to find it if it's a shim.
        result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        
        if result.returncode != 0:
            print(f"Installation failed with code {result.returncode}")
            if result.stdout: print(result.stdout)
            if result.stderr: print(result.stderr)
            
            # Common winget error codes handling
            if result.returncode == -1978335189: # Cancelled by user
                error_msg = "Installation cancelled by user."
            else:
                error_msg = "CUDA Toolkit installation failed. Please try running as Administrator or install manually."
                
            return {
                'success': False,
                'error': f"{error_msg} (Code: {result.returncode})"
            }
            
        print("✓ CUDA Toolkit installation completed via winget")
        print("Note: You may need to restart ComfyUI/Terminal for changes to take effect.")
        
        return {
            'success': True,
            'message': f"CUDA Toolkit {normalized_target or 'latest'} installed. Please restart your terminal/system."
        }

    # Linux Implementation
    print("\nUpgrading CUDA Toolkit. This may take several minutes...\n")

    cuda_uninstall_commands = [
        ['sudo', 'apt', 'remove', '-y', '--purge', 'cuda*', 'nsight*'],
        ['sudo', 'apt', 'autoremove', '-y'],
        ['sudo', 'rm', '-rf', '/usr/local/cuda*'],
        ['sudo', 'rm', '-rf', '/usr/local/cuda'],
    ]

    for cmd in cuda_uninstall_commands:
        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, shell=False)
        if result.returncode != 0 and 'sudo' in cmd:
            print("Note: sudo command failed, retrying without sudo...")
            cmd_no_sudo = [part for part in cmd if part != 'sudo']
            result = subprocess.run(cmd_no_sudo, capture_output=True, text=True, shell=False)
        if result.stdout:
            print(result.stdout)
        if result.stderr and 'No such file or directory' not in result.stderr:
            print(f"Note: {result.stderr}")

    print("✓ CUDA uninstallation completed")
    print("=" * 80 + "\n")

    setup_commands = [
        ['sudo', 'apt', 'update'],
        ['sudo', 'apt', 'install', '-y', 'wget', 'gnupg'],
        ['wget', 'https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb'],
        ['sudo', 'dpkg', '-i', 'cuda-keyring_1.1-1_all.deb'],
        ['sudo', 'apt', 'update'],
    ]

    for cmd in setup_commands:
        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 and 'sudo' in cmd:
            print("Note: sudo command failed, trying without sudo...")
            cmd_no_sudo = [part for part in cmd if part != 'sudo']
            result = subprocess.run(cmd_no_sudo, capture_output=True, text=True)
        if result.returncode != 0:
            return {
                'success': False,
                'error': 'CUDA Toolkit setup failed. Please install manually and try again.'
            }
        if result.stdout:
            print(result.stdout)

    if normalized_target:
        major, minor = normalized_target.split('.')
        cuda_package = f"cuda-toolkit-{major}-{minor}"
        install_cmd = ['sudo', 'apt', 'install', '-y', cuda_package]
        print(f"Installing CUDA toolkit {normalized_target} via package {cuda_package}")
    else:
        install_cmd = ['sudo', 'apt', 'install', '-y', 'cuda-toolkit']
        print("Installing latest CUDA toolkit package")

    result = subprocess.run(install_cmd, capture_output=True, text=True)
    if result.returncode != 0 and 'sudo' in install_cmd:
        print("Note: sudo command failed, trying without sudo...")
        install_cmd_no_sudo = [part for part in install_cmd if part != 'sudo']
        result = subprocess.run(install_cmd_no_sudo, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"CUDA installation failed: {result.stderr}")
        return {
            'success': False,
            'error': 'CUDA Toolkit installation failed. Please install manually and try again.'
        }

    print("✓ CUDA Toolkit installation completed")

    cuda_path_export = 'export PATH=/usr/local/cuda/bin:$PATH'
    cuda_lib_export = 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH'
    os.environ['PATH'] = f"/usr/local/cuda/bin:{os.environ.get('PATH', '')}"
    os.environ['LD_LIBRARY_PATH'] = f"/usr/local/cuda/lib64:{os.environ.get('LD_LIBRARY_PATH', '')}"

    bashrc_path = os.path.expanduser('~/.bashrc')
    try:
        bashrc_content = ''
        if os.path.exists(bashrc_path):
            with open(bashrc_path, 'r') as f:
                bashrc_content = f.read()
        if '/usr/local/cuda/bin' not in bashrc_content:
            with open(bashrc_path, 'a') as f:
                f.write('\n# CUDA Path (added by Nitra)\n')
                f.write(f'{cuda_path_export}\n')
                f.write(f'{cuda_lib_export}\n')
            print("✓ Added CUDA paths to ~/.bashrc")
        else:
            print("✓ CUDA paths already present in ~/.bashrc")
    except Exception as exc:
        print(f"Note: Unable to update ~/.bashrc automatically ({exc})")

    print("✓ CUDA added to current session PATH")

    print("\nVerifying CUDA installation...")
    nvcc_version = subprocess.run(['/usr/local/cuda/bin/nvcc', '--version'], capture_output=True, text=True)
    if nvcc_version.returncode != 0:
        nvcc_version = subprocess.run(['nvcc', '--version'], capture_output=True, text=True)
    print(nvcc_version.stdout)

    return {
        'success': True,
        'message': f"CUDA Toolkit {normalized_target or 'latest'} installed successfully."
    }

def install_pytorch(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Install PyTorch with torchvision and torchaudio
    Command format: pip install torch==<version> torchaudio torchvision --index-url https://download.pytorch.org/whl/cu128
    """
    try:
        torch_version = config.get('version', '').replace('==', '')
        cuda_label, _ = _resolve_cuda_versions(config.get('cudaVersion'))
        
        if not torch_version:
            return {'success': False, 'error': 'No torch version specified'}
        
        index_url = f"https://download.pytorch.org/whl/{cuda_label}"
        
        cmd = [
            sys.executable, '-m', 'pip', 'install', '--force-reinstall', '--no-warn-script-location',
            f"torch=={torch_version}",
            'torchaudio',
            'torchvision',
            '--index-url', index_url
        ]
        
        print("\n" + "="*80)
        print(f"NITRA: Starting PyTorch Installation/Upgrade")
        print("="*80)
        print(f"Version: PyTorch {torch_version}")
        print(f"CUDA: {cuda_label}")
        print(f"Index URL: {index_url}")
        print(f"Command: {' '.join(cmd)}")
        print("="*80 + "\n")
        
        logger.info(f"Installing PyTorch {torch_version} with {cuda_label}")
        
        # Step 1: Uninstall sageattention (it's tied to specific PyTorch versions)
        print("="*80)
        print("NITRA: Step 1 - Uninstalling sageattention (PyTorch version dependency)")
        print("="*80)
        
        uninstall_cmd = [sys.executable, '-m', 'pip', 'uninstall', '-y', 'sageattention']
        print(f"Command: {' '.join(uninstall_cmd)}")
        
        try:
            uninstall_process = subprocess.run(uninstall_cmd, capture_output=True, text=True, timeout=180)  # 3 minute timeout
            if uninstall_process.returncode == 0:
                print("✓ sageattention uninstalled successfully")
            else:
                print("ℹ sageattention was not installed (or already removed)")
        except subprocess.TimeoutExpired:
            print("⚠ sageattention uninstall timed out after 5 minutes - continuing with PyTorch installation")
        except KeyboardInterrupt:
            print("⚠ sageattention uninstall interrupted by user")
            raise  # Re-raise to stop the entire installation
        
        print("="*80 + "\n")
        
        # Step 2: Install PyTorch (with force-reinstall)
        print("="*80)
        print("NITRA: Step 2 - Installing PyTorch (force-reinstall)")
        print("="*80)
        print(f"Installation command: {' '.join(cmd)}")
        print("="*80)
        
        # Run with real-time output and timeout
        print("Starting PyTorch installation process...")
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Stream output in real-time
        output_lines = []
        for line in process.stdout:
            print(line, end='', flush=True)
            output_lines.append(line)
        
        # Wait for process to complete with timeout
        try:
            return_code = process.wait(timeout=600)  # 10 minute timeout
            print(f"\nProcess completed with return code: {return_code}")
        except subprocess.TimeoutExpired:
            print("\n" + "="*80)
            print("NITRA: PyTorch installation TIMEOUT (exceeded 10 minutes)")
            print("="*80 + "\n")
            process.kill()
            return {
                'success': False,
                'error': "PyTorch installation timeout (exceeded 10 minutes)"
            }
        
        if return_code != 0:
            print("\n" + "="*80)
            print("NITRA: PyTorch installation FAILED")
            print(f"Exit code: {return_code}")
            print("Last 20 lines of output:")
            for line in output_lines[-20:]:
                print(line.rstrip())
            print("="*80 + "\n")
            return {
                'success': False,
                'error': f"PyTorch installation failed with exit code {return_code}"
            }
        
        print("\n" + "="*80)
        print("NITRA: PyTorch installation completed successfully")
        print("="*80 + "\n")
        
        # Verify PyTorch installation
        print("Verifying PyTorch installation...")
        try:
            import torch
            print(f"✓ PyTorch version: {torch.__version__}")
            if torch.cuda.is_available():
                print(f"✓ CUDA available: {torch.version.cuda}")
                print(f"✓ CUDA device count: {torch.cuda.device_count()}")
            else:
                print("⚠ CUDA not available in PyTorch")
        except ImportError as e:
            print(f"⚠ PyTorch import failed: {e}")
            return {
                'success': False,
                'error': "PyTorch installation verification failed"
            }
        
        print("="*80 + "\n")
        
        # Reinstall custom nodes requirements
        print("\n" + "="*80)
        print("NITRA: Reinstalling custom node dependencies")
        print("="*80 + "\n")
        
        reinstall_result = reinstall_custom_nodes()
        
        print("\n" + "="*80)
        print(f"NITRA: Reinstalled {reinstall_result['count']} custom node requirement files")
        print("="*80 + "\n")
        
        return {
            'success': True,
            'message': f"PyTorch {torch_version} installed successfully",
            'custom_nodes_reinstalled': reinstall_result['count']
        }
        
    except Exception as e:
        print("\n" + "="*80)
        print(f"NITRA: PyTorch installation ERROR: {e}")
        print("="*80 + "\n")
        logger.error(f"PyTorch installation error: {e}")
        return {
            'success': False,
            'error': f"PyTorch installation failed: {str(e)}"
        }


def reinstall_custom_nodes() -> Dict[str, Any]:
    """Loop through all custom nodes and reinstall their requirements.txt"""
    try:
        custom_nodes_dir = Path(__file__).parent.parent.parent.parent / 'custom_nodes'
        
        if not custom_nodes_dir.exists():
            logger.warning(f"Custom nodes directory not found: {custom_nodes_dir}")
            return {'count': 0}
        
        requirements_files = list(custom_nodes_dir.rglob('requirements.txt'))
        count = 0
        total = len(requirements_files)
        
        print(f"Found {total} custom node requirement files to reinstall\n")
        
        for idx, req_file in enumerate(requirements_files, 1):
            try:
                node_name = req_file.parent.name
                print(f"[{idx}/{total}] Reinstalling: {node_name}")
                
                result = subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', '--no-warn-script-location', '-r', str(req_file)],
                    capture_output=True,
                    text=True,
                    timeout=180
                )
                
                if result.returncode == 0:
                    print(f"  ✓ Success: {node_name}")
                    count += 1
                else:
                    print(f"  ✗ Failed: {node_name}")
                    if result.stderr:
                        print(f"    Error: {result.stderr[:200]}")
                        
            except subprocess.TimeoutExpired:
                print(f"  ✗ Timeout: {node_name} (exceeded 3 minutes)")
            except Exception as e:
                print(f"  ✗ Error: {node_name} - {str(e)}")
        
        print(f"\nSuccessfully reinstalled {count}/{total} custom nodes\n")
        return {'count': count}
        
    except Exception as e:
        logger.warning(f"Failed to reinstall custom nodes: {e}")
        return {'count': 0}


def install_sageattention(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Install SageAttention - OS-specific installation logic
    """
    try:
        import platform
        os_name = platform.system().lower()
        
        print("\n" + "="*80)
        print(f"NITRA: Starting SageAttention Installation/Upgrade")
        print(f"Operating System: {os_name}")
        print("="*80)
        
        # Check OS compatibility
        if os_name == 'darwin':  # macOS
            return {
                'success': False,
                'error': 'SageAttention is not supported on macOS. Please use Windows or Linux.'
            }
        
        package_source = config.get('packageSource', '')
        version = config.get('version', '').replace('==', '')
        
        if os_name == 'linux':
            # Linux: Compile from source
            print("Linux detected: Compiling SageAttention from source")
            print("Repository: https://github.com/thu-ml/SageAttention.git")
            print("\n" + "="*80)
            print("NITRA: Checking and installing CUDA Toolkit requirements")
            print("="*80)
            
            # Get PyTorch CUDA version to match against
            print("Checking PyTorch CUDA version...")
            pytorch_cuda_version = None
            try:
                import torch
                if torch.cuda.is_available():
                    # Get CUDA version PyTorch was compiled with (e.g., "13.0")
                    pytorch_cuda_version = torch.version.cuda
                    print(f"PyTorch was compiled with CUDA: {pytorch_cuda_version}")
                else:
                    print("⚠ PyTorch CUDA not available")
            except Exception as e:
                print(f"⚠ Could not detect PyTorch CUDA version: {e}")
            
            # Check if CUDA toolkit is already installed and get version
            print("\nChecking installed CUDA toolkit version...")
            nvcc_check = subprocess.run(['which', 'nvcc'], capture_output=True, text=True)
            current_cuda_version = None
            needs_cuda_install = True
            
            if nvcc_check.returncode == 0:
                nvcc_version = subprocess.run(['nvcc', '--version'], capture_output=True, text=True)
                print("Current CUDA Toolkit:")
                print(nvcc_version.stdout)
                
                # Extract version number from nvcc output
                import re
                version_match = re.search(r'release (\d+\.\d+)', nvcc_version.stdout)
                if version_match:
                    current_cuda_version = version_match.group(1)
                    print(f"Detected installed CUDA toolkit: {current_cuda_version}")
                    
                    # Check if it matches PyTorch CUDA version
                    if pytorch_cuda_version:
                        # Compare major.minor versions (e.g., "13.0" == "13.0")
                        if current_cuda_version == pytorch_cuda_version:
                            print(f"✓ CUDA toolkit {current_cuda_version} matches PyTorch CUDA {pytorch_cuda_version}")
                            needs_cuda_install = False
                        else:
                            print(f"⚠ CUDA toolkit {current_cuda_version} does not match PyTorch CUDA {pytorch_cuda_version}, will upgrade")
            else:
                print("CUDA Toolkit not found, will install latest version")
            
            if needs_cuda_install:
                print("\nUpgrading CUDA Toolkit to latest version...")
                print("This may take several minutes.")
                
                # First, uninstall existing CUDA versions to avoid conflicts
                print("\n" + "="*80)
                print("NITRA: Uninstalling existing CUDA versions")
                print("="*80)
                
                # Remove all CUDA packages
                cuda_uninstall_commands = [
                ['sudo', 'apt', 'remove', '-y', '--purge', 'cuda*', 'nsight*'],
                ['sudo', 'apt', 'autoremove', '-y'],
                ['sudo', 'rm', '-rf', '/usr/local/cuda*'],
                ['sudo', 'rm', '-rf', '/usr/local/cuda']
            ]
            
            for cmd in cuda_uninstall_commands:
                print(f"Running: {' '.join(cmd)}")
                result = subprocess.run(cmd, capture_output=True, text=True, shell=False)
                
                # Check if the command failed
                if result.returncode != 0:
                    # If it's a package manager error, try to fix it with dpkg --configure -a
                    if 'sudo' in cmd and ('cuda*' in cmd or 'nsight*' in cmd):
                        print("⚠ Package removal failed, attempting to fix package manager state...")
                        fix_cmd = ['sudo', 'dpkg', '--configure', '-a']
                        print(f"Running: {' '.join(fix_cmd)}")
                        fix_result = subprocess.run(fix_cmd, capture_output=True, text=True)
                        
                        if fix_result.returncode == 0:
                            print("✓ Package manager state fixed, retrying removal...")
                            # Retry the original command
                            result = subprocess.run(cmd, capture_output=True, text=True, shell=False)
                        elif 'sudo' in fix_cmd:
                            print("Note: sudo dpkg failed, trying without sudo...")
                            fix_cmd_no_sudo = ['dpkg', '--configure', '-a']
                            fix_result = subprocess.run(fix_cmd_no_sudo, capture_output=True, text=True)
                            if fix_result.returncode == 0:
                                print("✓ Package manager state fixed, retrying removal...")
                                result = subprocess.run(cmd, capture_output=True, text=True, shell=False)
                    
                    # Check if sudo failed (common in Runpod)
                    if result.returncode != 0 and 'sudo' in cmd:
                        print(f"Note: sudo command failed, trying without sudo...")
                        cmd_no_sudo = [c for c in cmd if c != 'sudo']
                        result = subprocess.run(cmd_no_sudo, capture_output=True, text=True, shell=False)
                
                # Don't fail on uninstall errors - packages might not be installed
                if result.stdout:
                    print(result.stdout)
                if result.stderr and 'No such file or directory' not in result.stderr:
                    print(f"Note: {result.stderr}")
            
            print("✓ CUDA uninstallation completed")
            print("="*80 + "\n")
            
            # Install/upgrade CUDA toolkit dependencies
            cuda_setup_commands = [
                ['sudo', 'apt', 'update'],
                ['sudo', 'apt', 'install', '-y', 'wget', 'gnupg'],
                ['wget', 'https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb'],
                ['sudo', 'dpkg', '-i', 'cuda-keyring_1.1-1_all.deb'],
                ['sudo', 'apt', 'update']
            ]
            
            # Run setup commands
            for cmd in cuda_setup_commands:
                print(f"\nRunning: {' '.join(cmd)}")
                result = subprocess.run(cmd, capture_output=True, text=True)
                
                # Check if sudo failed (common in Runpod)
                if result.returncode != 0 and 'sudo' in cmd:
                    print(f"Note: sudo command failed, trying without sudo...")
                    cmd_no_sudo = [c for c in cmd if c != 'sudo']
                    result = subprocess.run(cmd_no_sudo, capture_output=True, text=True)
                
                if result.returncode != 0:
                    print(f"Warning: Command failed with error: {result.stderr}")
                    return {
                        'success': False,
                        'error': 'CUDA Toolkit setup failed. Please install manually and try again.'
                    }
                
                # Print output
                if result.stdout:
                    print(result.stdout)
            
            # Install CUDA toolkit matching PyTorch version
            if pytorch_cuda_version:
                print(f"\nInstalling CUDA toolkit {pytorch_cuda_version} to match PyTorch...")
                # Map PyTorch CUDA version to toolkit package (e.g., "13.0" -> "cuda-toolkit-13-0")
                cuda_major, cuda_minor = pytorch_cuda_version.split('.')
                cuda_toolkit_package = f"cuda-toolkit-{cuda_major}-{cuda_minor}"
                install_cmd = ['sudo', 'apt', 'install', '-y', cuda_toolkit_package]
                print(f"Installing specific CUDA toolkit: {cuda_toolkit_package}")
            else:
                print(f"\nInstalling latest CUDA toolkit (PyTorch CUDA version unknown)...")
                install_cmd = ['sudo', 'apt', 'install', '-y', 'cuda-toolkit']
            
            result = subprocess.run(install_cmd, capture_output=True, text=True)
            
            # If sudo fails, try without sudo (common in Runpod environments)
            if result.returncode != 0 and 'sudo' in install_cmd:
                print("Note: sudo not available, trying without sudo...")
                install_cmd_no_sudo = [c for c in install_cmd if c != 'sudo']
                print(f"Command: {' '.join(install_cmd_no_sudo)}")
                result = subprocess.run(install_cmd_no_sudo, capture_output=True, text=True)
            
            if result.returncode == 0:
                if pytorch_cuda_version:
                    print(f"✓ Successfully installed CUDA toolkit {pytorch_cuda_version}")
                else:
                    print(f"✓ Successfully installed latest CUDA toolkit")
                if result.stdout:
                    print(result.stdout)
            else:
                print(f"CUDA installation failed: {result.stderr}")
                print("You may need to install CUDA Toolkit manually.")
                print("Please run the following commands:")
                print("  sudo apt update")
                print("  sudo apt install -y wget gnupg")
                print("  wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb")
                print("  sudo dpkg -i cuda-keyring_1.1-1_all.deb")
                print("  sudo apt update")
                print("  sudo apt install -y cuda-toolkit")
                
                return {
                    'success': False,
                    'error': 'CUDA Toolkit installation failed. Please install manually and try again.'
                }
            
            print("✓ CUDA Toolkit upgrade completed")
            
            # Add CUDA to PATH
            print("\nAdding CUDA to PATH...")
            cuda_path_export = 'export PATH=/usr/local/cuda/bin:$PATH'
            cuda_lib_export = 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH'
            
            # Add to current process environment
            import os
            os.environ['PATH'] = f"/usr/local/cuda/bin:{os.environ.get('PATH', '')}"
            os.environ['LD_LIBRARY_PATH'] = f"/usr/local/cuda/lib64:{os.environ.get('LD_LIBRARY_PATH', '')}"
            
            # Add to bashrc for persistence
            bashrc_path = os.path.expanduser('~/.bashrc')
            try:
                with open(bashrc_path, 'r') as f:
                    bashrc_content = f.read()
                
                if '/usr/local/cuda/bin' not in bashrc_content:
                    with open(bashrc_path, 'a') as f:
                        f.write('\n# CUDA Path (added by Nitra)\n')
                        f.write(f'{cuda_path_export}\n')
                        f.write(f'{cuda_lib_export}\n')
                    print("✓ Added CUDA to ~/.bashrc for future sessions")
                else:
                    print("✓ CUDA already in ~/.bashrc")
            except Exception as e:
                print(f"Note: Could not update ~/.bashrc: {e}")
            
            print("✓ CUDA added to current session PATH")
            
            # Clear hash cache
            print("Clearing hash cache...")
            subprocess.run(['hash', '-r'], shell=True, capture_output=True, text=True)
            
            # Verify installation
            print("\nVerifying CUDA installation...")
            # Use full path to ensure we get the right nvcc
            nvcc_version = subprocess.run(['/usr/local/cuda/bin/nvcc', '--version'], capture_output=True, text=True)
            if nvcc_version.returncode == 0:
                print(nvcc_version.stdout)
            else:
                # Fallback to PATH nvcc
                nvcc_version = subprocess.run(['nvcc', '--version'], capture_output=True, text=True)
                print(nvcc_version.stdout)
            
            print("="*80 + "\n")
            
            # Clone and compile from source
            import tempfile
            import shutil
            
            temp_dir = tempfile.mkdtemp()
            repo_url = "https://github.com/thu-ml/SageAttention.git"
            
            try:
                print("="*80)
                print("NITRA: Cloning SageAttention repository")
                print("="*80)
                
                # Clone repository
                clone_cmd = ['git', 'clone', repo_url, temp_dir]
                print(f"Command: {' '.join(clone_cmd)}")
                
                clone_process = subprocess.run(clone_cmd, capture_output=True, text=True)
                if clone_process.returncode != 0:
                    return {
                        'success': False,
                        'error': f'Failed to clone repository: {clone_process.stderr}'
                    }
                
                print("✓ Repository cloned successfully")
                print("="*80 + "\n")
                
                # Install ninja build system
                print("="*80)
                print("NITRA: Installing ninja build system")
                print("="*80)
                
                ninja_install_cmd = [sys.executable, '-m', 'pip', 'install', '--no-warn-script-location', 'ninja']
                print(f"Installing ninja: {' '.join(ninja_install_cmd)}")
                ninja_result = subprocess.run(ninja_install_cmd, capture_output=True, text=True)
                
                if ninja_result.returncode == 0:
                    print("✓ Ninja installed successfully")
                    if ninja_result.stdout:
                        print(ninja_result.stdout)
                else:
                    print(f"⚠ Ninja installation failed: {ninja_result.stderr}")
                    print("Continuing with compilation (ninja may not be available)")
                
                print("="*80 + "\n")
                
                # Compile and install
                print("="*80)
                print("NITRA: Compiling SageAttention from source")
                print("="*80)
                print("⚠️  WARNING: Compilation may take up to 20 minutes")
                print("⚠️  Please be patient and do not interrupt the process")
                print("="*80)
                
                compile_cmd = [sys.executable, 'setup.py', 'install']
                print(f"Command: {' '.join(compile_cmd)}")
                print("="*80 + "\n")
                
                process = subprocess.Popen(
                    compile_cmd,
                    cwd=temp_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True
                )
                
                for line in process.stdout:
                    print(line, end='', flush=True)
                
                process.wait()
                
                if process.returncode == 0:
                    print("\n" + "="*80)
                    print("NITRA: SageAttention compilation and installation completed successfully")
                    print("="*80 + "\n")
                    return {'success': True}
                else:
                    return {
                        'success': False,
                        'error': f'Compilation failed with return code: {process.returncode}'
                    }
                    
            finally:
                # Clean up temporary directory
                shutil.rmtree(temp_dir, ignore_errors=True)
                
        elif os_name == 'windows':
            # Windows: Use precompiled wheel or PyPI
            print("Windows detected: Using precompiled wheel or PyPI")
            
            # If packageSource is a URL (precompiled wheel), use it
            if package_source.startswith('http'):
                cmd = [sys.executable, '-m', 'pip', 'install', '-U', '--force-reinstall', '--no-warn-script-location', package_source]
                print(f"Source: Precompiled wheel")
                print(f"URL: {package_source}")
            elif version:
                # Use specific version from PyPI
                cmd = [sys.executable, '-m', 'pip', 'install', '-U', '--no-warn-script-location', f'sageattention=={version}']
                print(f"Source: PyPI")
                print(f"Version: {version}")
            else:
                # Fallback to version 1.0.6
                cmd = [sys.executable, '-m', 'pip', 'install', '-U', '--no-warn-script-location', 'sageattention==1.0.6']
                print(f"Source: PyPI (fallback)")
                print(f"Version: 1.0.6")
            
            print(f"Command: {' '.join(cmd)}")
            print("="*80 + "\n")
            
            # Run with real-time output
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            
            for line in process.stdout:
                print(line, end='', flush=True)
            
            process.wait()
            
            if process.returncode == 0:
                print("\n" + "="*80)
                print("NITRA: SageAttention installation completed successfully")
                print("="*80 + "\n")
                return {'success': True}
            else:
                return {
                    'success': False,
                    'error': f'Installation failed with return code: {process.returncode}'
                }
        else:
            return {
                'success': False,
                'error': f'Unsupported operating system: {os_name}'
            }
            
    except subprocess.TimeoutExpired:
        print("\n" + "="*80)
        print("NITRA: SageAttention installation TIMEOUT (exceeded 5 minutes)")
        print("="*80 + "\n")
        return {
            'success': False,
            'error': "Installation timeout (exceeded 5 minutes)"
        }
    except Exception as e:
        print("\n" + "="*80)
        print(f"NITRA: SageAttention installation ERROR: {e}")
        print("="*80 + "\n")
        logger.error(f"SageAttention installation error: {e}")
        return {
            'success': False,
            'error': f"SageAttention installation failed: {str(e)}"
        }


def install_cuda_toolkit(config: Dict[str, Any]) -> Dict[str, Any]:
    target_version = config.get('targetVersion')
    if isinstance(target_version, str):
        target_version = target_version.strip()
    if not target_version:
        target_version = None
    return _upgrade_cuda_toolkit(target_version)


def open_vs_build_shell(config: Dict[str, Any]) -> Dict[str, Any]:
    """Launch a Visual Studio Build Tools developer shell in a new console window."""
    os_name = platform.system().lower()
    if os_name != 'windows':
        return {
            'success': False,
            'error': 'Build Tools shell is only available on Windows.'
        }

    custom_path = config.get('shellScriptPath')
    candidate_paths = []

    if custom_path:
        candidate_paths.append(custom_path)

    candidate_paths.extend([
        r"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1",
        r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Launch-VsDevShell.ps1",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Launch-VsDevShell.ps1",
    ])

    shell_script = next((path for path in candidate_paths if path and os.path.isfile(path)), None)
    if not shell_script:
        return {
            'success': False,
            'error': 'Could not find Launch-VsDevShell.ps1. Please install Microsoft Build Tools first.'
        }

    machine = platform.machine().lower()
    if 'arm' in machine:
        arch = 'arm64' if '64' in machine else 'arm'
    elif '64' in machine:
        arch = 'amd64'
    else:
        arch = 'x86'

    ps_command = [
        'powershell.exe',
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-File', shell_script,
        '-Arch', arch
    ]
    creation_flag = getattr(subprocess, 'CREATE_NEW_CONSOLE', 0x00000010)

    try:
        subprocess.Popen(ps_command, creationflags=creation_flag)
        return {
            'success': True,
            'message': f'Build Tools PowerShell opened targeting {arch}.'
        }
    except Exception as exc:
        logger.error("Failed to launch Build Tools shell: %s", exc)
        return {
            'success': False,
            'error': f'Failed to launch Build Tools shell: {exc}'
        }


def install_vs_build_tools(config: Dict[str, Any]) -> Dict[str, Any]:
    """Install Visual Studio Build Tools 2022 on Windows."""
    os_name = platform.system().lower()
    if os_name != 'windows':
        return {
            'success': False,
            'error': 'Visual Studio Build Tools installation is only supported on Windows.'
        }

    print("\n" + "=" * 80)
    print("NITRA: Installing Visual Studio Build Tools 2022")
    print("=" * 80)
    
    # Check for winget
    try:
        subprocess.run(['winget', '--version'], check=True, capture_output=True, shell=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {
            'success': False,
            'error': 'winget not found. Please install App Installer from Microsoft Store.'
        }

    print("Note: This process will download and install Microsoft Visual Studio Build Tools.")
    print("It requires Administrator privileges and may prompt for confirmation.")
    print("Workloads: Desktop development with C++ (Microsoft.VisualStudio.Workload.VCTools)")
    
    # Command construction
    # --passive: Displays progress but doesn't require interaction (shows UI)
    # --wait: Waits for installation to finish
    # --add: Specifies the workload
    install_params = '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    
    cmd = [
        'winget', 'install', '-e', 
        '--id', 'Microsoft.VisualStudio.2022.BuildTools', 
        '--silent',  # tells winget to be silent (passes quiet/passive to installer via override)
        '--override', f'"{install_params}"',
        '--accept-package-agreements', 
        '--accept-source-agreements',
        '--force' # Force install even if already installed (to ensure workloads are present)
    ]
    
    # Note: winget argument parsing can be tricky with quotes in subprocess. 
    # We'll construct a string command for shell=True to be safe with the nested quotes in override.
    cmd_str = f'winget install -e --id Microsoft.VisualStudio.2022.BuildTools --silent --override "{install_params}" --accept-package-agreements --accept-source-agreements --force'
    
    print(f"Running command: {cmd_str}")
    
    process = subprocess.Popen(
        cmd_str,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        shell=True
    )
    
    for line in process.stdout:
        print(line, end='', flush=True)
        
    process.wait()
    
    # Check specific exit codes
    # 0: Success
    # 3010: Success, Reboot Required
    if process.returncode == 0:
        print("\n" + "=" * 80)
        print("NITRA: VS Build Tools installation completed successfully")
        print("=" * 80 + "\n")
        return {'success': True, 'message': 'Visual Studio Build Tools installed successfully.'}
    elif process.returncode == 3010:
        print("\n" + "=" * 80)
        print("NITRA: VS Build Tools installed (Reboot Required)")
        print("=" * 80 + "\n")
        return {'success': True, 'message': 'Installation successful. Please reboot your computer.'}
    else:
        print("\n" + "=" * 80)
        print(f"NITRA: Installation failed with code {process.returncode}")
        print("=" * 80 + "\n")
        return {'success': False, 'error': f"Installation failed with code {process.returncode}. You may need to run as Administrator."}


def install_onnxruntime_gpu(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    ONNX Fix (Fix Slow Pose and Depth)
    Steps: 1) Uninstall onnxruntime, 2) Install onnxruntime-gpu and onnx
    """
    try:
        print("\n" + "="*80)
        print(f"NITRA: Starting ONNX Runtime GPU Installation/Upgrade")
        print("="*80)
        
        # Step 1: Uninstall onnxruntime (CPU version) - must be removed before GPU install
        print("Step 1: Uninstalling onnxruntime (CPU version)...")
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'uninstall', '-y', 'onnxruntime'],
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode == 0:
            print("  ✓ CPU version uninstalled")
        else:
            print("  ℹ CPU version not found (already uninstalled)")
        
        # Step 2: Install/upgrade onnxruntime-gpu and onnx
        print("\nStep 2: Installing/upgrading onnxruntime-gpu and onnx...")
        cmd = [sys.executable, '-m', 'pip', 'install', '-U', '--no-warn-script-location', 'onnxruntime-gpu', 'onnx']
        print(f"Command: {' '.join(cmd)}")
        print("="*80 + "\n")
        
        # Run with real-time output
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        for line in process.stdout:
            print(line, end='', flush=True)
        
        process.wait()
        
        if process.returncode == 0:
            print("\n" + "="*80)
            print("NITRA: ONNX Runtime GPU installation completed successfully")
            print("="*80 + "\n")
            return {
                'success': True,
                'message': "ONNX Runtime GPU installed successfully"
            }
        else:
            print("\n" + "="*80)
            print("NITRA: ONNX Runtime GPU installation FAILED")
            print("="*80 + "\n")
            return {
                'success': False,
                'error': f"ONNX Runtime GPU installation failed with exit code {process.returncode}"
            }
            
    except subprocess.TimeoutExpired:
        print("\n" + "="*80)
        print("NITRA: ONNX Runtime GPU installation TIMEOUT")
        print("="*80 + "\n")
        return {
            'success': False,
            'error': "Installation timeout"
        }
    except Exception as e:
        print("\n" + "="*80)
        print(f"NITRA: ONNX Runtime GPU installation ERROR: {e}")
        print("="*80 + "\n")
        logger.error(f"ONNX Runtime GPU installation error: {e}")
        return {
            'success': False,
            'error': f"ONNX Runtime GPU installation failed: {str(e)}"
        }


def install_triton_windows(config: Dict[str, Any]) -> Dict[str, Any]:
    """Install Triton for Windows"""
    try:
        version = config.get('version', '').replace('==', '')
        current_version = _get_installed_triton_version()
        
        print("\n" + "="*80)
        print(f"NITRA: Starting Triton Windows Installation/Upgrade")
        print("="*80)

        if version and current_version:
            try:
                if pkg_version.parse(current_version) > pkg_version.parse(version):
                    print(f"Detected triton-windows {current_version}, which is newer than requested {version}.")
                    print("Uninstalling current version so we can downgrade...")
                    _run_uninstall_triton()
            except Exception as exc:
                print(f"Warning: Unable to compare versions ({exc}). Continuing with installation.")
        elif not version and current_version:
            print(f"Current installed version: {current_version}")
        
        if version:
            cmd = [sys.executable, '-m', 'pip', 'install', '-U', '--no-warn-script-location', f'triton-windows=={version}']
            print(f"Version: {version}")
        else:
            cmd = [sys.executable, '-m', 'pip', 'install', '-U', '--no-warn-script-location', 'triton-windows']
            print(f"Version: Latest")
        
        print(f"Command: {' '.join(cmd)}")
        print("="*80 + "\n")
        
        # Run with real-time output
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        for line in process.stdout:
            print(line, end='', flush=True)
        
        process.wait()
        
        if process.returncode == 0:
            print("\n" + "="*80)
            print("NITRA: Triton Windows installation completed successfully")
            print("="*80 + "\n")
            return {
                'success': True,
                'message': f"Triton Windows installed successfully"
            }
        else:
            print("\n" + "="*80)
            print("NITRA: Triton Windows installation FAILED")
            print("="*80 + "\n")
            return {
                'success': False,
                'error': f"Triton Windows installation failed with exit code {process.returncode}"
            }
            
    except subprocess.TimeoutExpired:
        print("\n" + "="*80)
        print("NITRA: Triton Windows installation TIMEOUT (exceeded 5 minutes)")
        print("="*80 + "\n")
        return {
            'success': False,
            'error': "Installation timeout (exceeded 5 minutes)"
        }
    except Exception as e:
        print("\n" + "="*80)
        print(f"NITRA: Triton Windows installation ERROR: {e}")
        print("="*80 + "\n")
        logger.error(f"Triton Windows installation error: {e}")
        return {
            'success': False,
            'error': f"Triton Windows installation failed: {str(e)}"
        }


def _get_installed_triton_version() -> Optional[str]:
    """Return the currently installed triton-windows version, if any."""
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'show', 'triton-windows'],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            return None
        for line in result.stdout.splitlines():
            if line.lower().startswith('version:'):
                return line.split(':', 1)[1].strip()
    except Exception:
        return None
    return None


def _run_uninstall_triton():
    """Attempt to uninstall triton-windows before reinstalling/downgrading."""
    try:
        cmd = [sys.executable, '-m', 'pip', 'uninstall', '-y', 'triton-windows']
        print(f"Running uninstall command: {' '.join(cmd)}")
        subprocess.run(cmd, check=False, text=True)
    except Exception as exc:
        print(f"Warning: Unable to uninstall triton-windows automatically ({exc}). Continuing...")


def main():
    """Main entry point"""
    try:
        if len(sys.argv) < 3:
            print("Usage: package_installer.py <category> <config_json>", file=sys.stderr)
            sys.exit(1)
        
        category = sys.argv[1].lower()
        config = json.loads(sys.argv[2])

        try:
            _verify_prerequisites()
        except RuntimeError as err:
            logger.error(str(err))
            result = {
                'success': False,
                'error': str(err),
            }
            print(json.dumps(result), file=sys.stderr, flush=True)
            sys.exit(1)
        
        if category == 'pytorch':
            result = install_pytorch(config)
        elif category == 'sageattention':
            result = install_sageattention(config)
        elif category == 'onnxruntime-gpu':
            result = install_onnxruntime_gpu(config)
        elif category == 'triton-windows':
            result = install_triton_windows(config)
        elif category == 'cuda-toolkit':
            result = install_cuda_toolkit(config)
        elif category == 'vs-build-tools':
            result = install_vs_build_tools(config)
        elif category == 'vs-build-shell':
            result = open_vs_build_shell(config)
        else:
            result = {
                'success': False,
                'error': f'Unknown category: {category}'
            }
        
        # Output JSON result to stderr so it can be captured separately from terminal output
        print(json.dumps(result), file=sys.stderr, flush=True)
        sys.exit(0 if result['success'] else 1)
        
    except Exception as e:
        logger.error(f"Main execution error: {e}")
        result = {
            'success': False,
            'error': f"Execution error: {str(e)}"
        }
        print(json.dumps(result), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

