"""
Logging configuration module for ComfyUI setup
"""

import os
import sys
import logging
from typing import Optional


def setup_logging(log_dir: Optional[str] = None, log_level: int = logging.INFO) -> logging.Logger:
    """
    Setup logging configuration
    
    Args:
        log_dir: Directory for log files. If None, uses environment variable or default.
        log_level: Logging level (default: INFO)
        
    Returns:
        Configured logger instance
    """
    if log_dir is None:
        log_dir = os.environ.get('LOG_DIR', os.path.join(os.environ.get('COMFY_DIR', '/workspace/ao_labs'), 'logs'))
    
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, 'setup.log')
    
    # Clear any existing handlers
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create handlers with proper encoding
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    console_handler = logging.StreamHandler(sys.stdout)
    
    # Set encoding for console handler to handle Unicode
    if hasattr(console_handler.stream, 'reconfigure'):
        console_handler.stream.reconfigure(encoding='utf-8', errors='replace')
    
    # Different formats for console (simple) and file (detailed)
    file_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    console_formatter = logging.Formatter('%(message)s')  # Console: message only
    
    file_handler.setFormatter(file_formatter)
    console_handler.setFormatter(console_formatter)
    
    logging.basicConfig(
        level=log_level,
        handlers=[
            file_handler,
            console_handler
        ]
    )
    
    return logging.getLogger(__name__)


def get_logger(name: str = __name__) -> logging.Logger:
    """Get a logger instance with the given name"""
    return logging.getLogger(name)
