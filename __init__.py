"""
ComfyUI-Nitra Extension
Provides authentication, model management, and environment update functionality.
"""

import logging

WEB_DIRECTORY = "web"

# Define empty mappings so the module imports successfully and the web folder is registered.
# This follows the same pattern used by ComfyUI-Manager and ComfyUI-SubgraphSearch.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Import server module to register routes - EXACT same pattern as ComfyUI-Manager
try:
    from . import nitra_server  # Routes register automatically on import
    logging.info("Nitra: Server routes registered successfully")
except Exception as e:
    logging.error(f"Nitra: Failed to register server routes: {e}")
    import traceback
    traceback.print_exc()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
