// Model selection state management
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';

let modelButtonUpdateToken = 0;

function resetModelLoadingState(button, container) {
    if (button) {
        button.classList.remove('nitra-loading');
        button.removeAttribute('aria-busy');
        button.removeAttribute('data-loading-token');
    }
    if (container) {
        container.classList.remove('nitra-loading');
        container.style.pointerEvents = '';
        container.style.opacity = '';
        container.removeAttribute('data-loading-token');
    }
}

function startModelLoadingState(button, container, token) {
    if (button) {
        button.dataset.loadingToken = String(token);
        button.classList.add('nitra-loading');
        button.setAttribute('aria-busy', 'true');
        button.disabled = true;
        button.textContent = 'Updating...';
    }
    if (container) {
        container.dataset.loadingToken = String(token);
        container.classList.add('nitra-loading');
        if (container.style.display === 'none') {
            container.style.display = 'block';
        }
        container.style.pointerEvents = 'none';
        container.style.opacity = '0.6';
    }
}

function finishModelLoadingState(button, container, token) {
    if (button && button.dataset.loadingToken === String(token)) {
        button.classList.remove('nitra-loading');
        button.removeAttribute('aria-busy');
        button.removeAttribute('data-loading-token');
    }
    if (container && container.dataset.loadingToken === String(token)) {
        container.classList.remove('nitra-loading');
        container.style.pointerEvents = '';
        container.style.opacity = '';
        container.removeAttribute('data-loading-token');
    }
}

function waitForNextFrame() {
    return new Promise(resolve => {
        const win = typeof window !== 'undefined' ? window : null;
        if (win && typeof win.requestAnimationFrame === 'function') {
            win.requestAnimationFrame(() => resolve());
            return;
        }
        if (win && typeof win.setTimeout === 'function') {
            win.setTimeout(resolve, 16);
            return;
        }
        setTimeout(resolve, 16);
    });
}

export async function updateModelDownloadButton() {
    const downloadBtn = document.getElementById('nitra-download-models-btn');
    const hfTokenContainer = document.getElementById('nitra-hf-token-container');
    
    if (!downloadBtn) {
        return;
    }
    
    resetModelLoadingState(downloadBtn, hfTokenContainer);
    
    // Don't disable button if download is ongoing (for cancel functionality)
    downloadBtn.disabled = state.selectedModels.size === 0 && !state.ongoingModelDownload;
    
    if (state.ongoingModelDownload) {
        downloadBtn.textContent = 'Cancel Download';
        downloadBtn.style.background = '#dc3545'; // Red for cancel
        if (hfTokenContainer) {
            hfTokenContainer.style.display = 'none';
            const hfTokenInput = document.getElementById('nitra-hf-token');
            if (hfTokenInput) hfTokenInput.value = '';
        }
        return;
    }
    
    if (state.selectedModels.size === 0) {
        downloadBtn.textContent = 'Select Models to Download';
        downloadBtn.style.background = '#0b0b0b'; // Reset to monochrome color
        if (hfTokenContainer) {
            hfTokenContainer.style.display = 'none';
            const hfTokenInput = document.getElementById('nitra-hf-token');
            if (hfTokenInput) hfTokenInput.value = '';
        }
        return;
    }
    
    const updateToken = ++modelButtonUpdateToken;
    startModelLoadingState(downloadBtn, hfTokenContainer, updateToken);
    await waitForNextFrame();
    
    let totalSize = 0;
    let requiresHFToken = false;
    
    state.selectedModels.forEach(modelId => {
        const model = state.modelsData.find(m => m.id === modelId);
        if (model) {
            if (model.size) {
                totalSize += model.size;
            }
            if (model.hfTokenRequired) {
                requiresHFToken = true;
            }
        }
    });
    
    finishModelLoadingState(downloadBtn, hfTokenContainer, updateToken);
    
    if (modelButtonUpdateToken !== updateToken) {
        return;
    }
    
    const totalSizeGB = totalSize > 0 ? totalSize.toFixed(1) : 0;
    downloadBtn.textContent = `Download ${state.selectedModels.size} Model${state.selectedModels.size === 1 ? '' : 's'} (${totalSizeGB} GB)`;
    downloadBtn.style.background = '#0b0b0b'; // Reset to monochrome color
    downloadBtn.disabled = false;
    
    if (hfTokenContainer) {
        hfTokenContainer.style.display = 'block';
        const prefixElement = document.getElementById('nitra-hf-token-prefix');
        if (prefixElement) {
            if (requiresHFToken) {
                prefixElement.textContent = 'Required:';
                prefixElement.style.color = '#ef4444'; // Red color
            } else {
                prefixElement.textContent = 'Optional:';
                prefixElement.style.color = '#4ade80'; // Green color
            }
        }
        const helpElement = document.getElementById('nitra-hf-token-help');
        if (helpElement) {
            if (requiresHFToken) {
            helpElement.innerHTML = 'A HuggingFace token is required for some selected models. <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:#ffffff; text-decoration:underline;">Click here to create token</a>';
            } else {
            helpElement.innerHTML = 'Enter your HuggingFace token for faster downloads and access to private models. <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:#ffffff; text-decoration:underline;">Click here to create token</a>';
            }
        }
        
        const toggleBtn = document.getElementById('nitra-hf-token-toggle');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                const tokenInput = document.getElementById('nitra-hf-token');
                if (tokenInput) {
                    if (tokenInput.type === 'password') {
                        tokenInput.type = 'text';
                        toggleBtn.textContent = 'Hide';
                        toggleBtn.title = 'Hide password';
                    } else {
                        tokenInput.type = 'password';
                        toggleBtn.textContent = 'Show';
                        toggleBtn.title = 'Show password';
                    }
                }
            };
        }
        
        const tokenInput = document.getElementById('nitra-hf-token');
        if (tokenInput && !tokenInput.value.trim()) {
            fetch('/nitra/user-config')
                .then(r => r.ok ? r.json() : null)
                .then(cfg => {
                    if (cfg && cfg.huggingface_token && typeof cfg.huggingface_token === 'string' && cfg.huggingface_token.trim()) {
                        tokenInput.value = cfg.huggingface_token;
                    }
                })
                .catch(() => {});
        }
    }
}










