// Package-specific modals for optimizer
// Each package has its own modal with specific UI requirements

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { fetchComfyConfigs } from './comfy-config-api.js';
import { ensureFreshAccessToken } from '../auth/session.js';
import {
    getActiveApiToken,
    getStoredUserId,
    getStoredUserEmail,
} from '../auth/storage.js';

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return value
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Show loading modal
function showLoadingModal() {
    const loadingModal = document.createElement('div');
    loadingModal.id = 'nitra-loading-modal';
    loadingModal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    loadingModal.innerHTML = `
        <div style="
            background: #1a1a1a;
            padding: 30px 40px;
            border-radius: 8px;
            text-align: center;
            border: 1px solid #333;
        ">
            <div style="
                width: 40px;
                height: 40px;
                border: 4px solid #333;
                border-top-color: #ffffff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
            "></div>
            <div style="color: #f0f0f0; font-size: 16px;">Loading package information...</div>
        </div>
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(loadingModal);
    return loadingModal;
}

// Hide loading modal
function hideLoadingModal() {
    const loadingModal = document.getElementById('nitra-loading-modal');
    if (loadingModal) {
        document.body.removeChild(loadingModal);
    }
}

async function getPyPIVersion(packageName) {
    try {
        const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${packageName} version from PyPI`);
        }
        const data = await response.json();
        return data.info.version;
    } catch (error) {
        console.warn(`Failed to get PyPI version for ${packageName}:`, error);
        return 'Unknown';
    }
}

async function getCurrentVersions() {
    try {
        const response = await fetch('/nitra/check-versions');
        if (!response.ok) {
            throw new Error('Failed to get current versions');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting current versions:', error);
        return null;
    }
}

async function installPackage(category, config) {
    try {
        const hasSession = await ensureFreshAccessToken();
        if (!hasSession) {
            throw new Error('Session expired. Please sign in again.');
        }

        const token = getActiveApiToken();
        const userId = state.currentUser?.id || getStoredUserId();
        const userEmail = state.currentUser?.email || getStoredUserEmail();
        if (!token || !userId) {
            throw new Error('User not authenticated');
        }
        
        const response = await fetch('/nitra/install/package', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                category: category,
                config: config,
                user_id: userId,
                user_email: userEmail
            })
        });
        
        const result = await response.json();
        
        // Check if the response indicates success
        if (response.ok && result.status === 'success') {
            return { success: true, message: result.message, details: result.details };
        } else {
            return { success: false, error: result.message || 'Installation failed' };
        }
    } catch (error) {
        console.error('Error installing package:', error);
        return { success: false, error: error.message };
    }
}

function createModalBase(title, content, onClose) {
    const modal = document.createElement('div');
    modal.className = 'nitra-package-modal';
    modal.innerHTML = `
        <div class="nitra-package-modal-overlay"></div>
        <div class="nitra-package-modal-content">
            <div class="nitra-package-modal-header">
                <h2>${title}</h2>
                <button class="nitra-package-modal-close">&times;</button>
            </div>
            <div class="nitra-package-modal-body">
                ${content}
            </div>
        </div>
    `;
    
    const style = document.createElement('style');
    style.textContent = `
        .nitra-package-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .nitra-package-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
        }
        
        .nitra-package-modal-content {
            position: relative;
            background: #000000;
            border-radius: 18px;
            max-width: 640px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 45px rgba(0, 0, 0, 0.65);
            border: 1px solid #ffffff;
            color: #ffffff;
        }
        
        .nitra-package-modal-header {
            padding: 18px 28px;
            border-bottom: 1px solid #ffffff;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #000000;
        }
        
        .nitra-package-modal-header h2 {
            margin: 0;
            color: #ffffff;
            font-size: 1.5em;
        }
        
        .nitra-package-modal-close {
            background: #000000;
            border: 1px solid #ffffff;
            color: #ffffff;
            font-size: 1.4em;
            cursor: pointer;
            line-height: 1;
            padding: 4px;
            width: 38px;
            height: 38px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .nitra-package-modal-close:hover {
            transform: translateY(-1px);
            box-shadow: 0 0 18px rgba(255,255,255,0.4);
        }
        
        .nitra-package-modal-body {
            padding: 30px;
            background: #000000;
            color: #ffffff;
        }
        
        .nitra-version-display {
            background: #050505;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
            border: 1px solid #ffffff;
        }
        
        .nitra-version-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            color: #f0f0f0;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .nitra-version-row:last-child {
            border-bottom: none;
        }
        
        .nitra-version-label {
            font-weight: 600;
            color: #ffffff;
        }
        
        .nitra-version-value {
            color: #f9fafb;
        }

        .nitra-version-hint {
            font-size: 11px;
            color: rgba(249,250,251,0.75);
            margin-top: 2px;
            word-break: break-all;
        }
        
        .nitra-dropdown {
            width: 100%;
            padding: 12px;
            background: #000000;
            color: #ffffff;
            border: 1px solid #ffffff;
            border-radius: 10px;
            font-size: 1em;
            margin-bottom: 20px;
        }
        
        .nitra-modal-buttons {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        
        .nitra-modal-btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1em;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        
        .nitra-modal-btn-primary {
            background: #000000;
            color: #ffffff;
            border: 1px solid #ffffff;
        }
        
        .nitra-modal-btn-primary:hover {
            background: #141414;
        }
        
        .nitra-modal-btn-primary:disabled {
            background: #252525;
            border-color: #444;
            cursor: not-allowed;
            color: #888;
        }
        
        .nitra-modal-btn-secondary {
            background: #000000;
            color: #ffffff;
            border: 1px solid #ffffff;
        }
        
        .nitra-modal-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .nitra-modal-btn-warning {
            background: #000000;
            border: 1px solid #ffffff;
            color: #ffffff;
        }
        
        .nitra-availability-check {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-weight: 600;
            border: 1px solid #ffffff;
            background: #050505;
        }
        
        .nitra-availability-available {
            background: rgba(76, 175, 80, 0.15);
            color: #4caf50;
            border-color: rgba(76,175,80,0.6);
        }
        
        .nitra-availability-unavailable {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border-color: rgba(239,68,68,0.6);
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(modal);
    
    modal.querySelector('.nitra-package-modal-close').onclick = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
        if (onClose) onClose();
    };
    
    modal.querySelector('.nitra-package-modal-overlay').onclick = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
        if (onClose) onClose();
    };
    
    return { modal, style };
}

// PyTorch Modal: Display current Python/Torch/CUDA versions, dropdown with torch options, Install/Cancel buttons
export async function showPyTorchModal() {
    const loadingModal = showLoadingModal();
    
    try {
        const versions = await getCurrentVersions();
        const configs = await fetchComfyConfigs();
        const pytorchConfigs = configs.filter(c => c.category === 'pytorch');
        
        hideLoadingModal();

    const normalizeCudaValue = (value) => {
        if (!value && value !== 0) {
            return null;
        }
        let cleaned = value.toString().trim();
        cleaned = cleaned.replace(/^>=/, '').replace(/^==/, '');
        if (!cleaned) {
            return null;
        }
        cleaned = cleaned.replace(/[^0-9.]/g, '');
        if (!cleaned) {
            return null;
        }
        if (cleaned.includes('.')) {
            return cleaned;
        }
        if (cleaned.length >= 3) {
            return `${parseInt(cleaned.slice(0, 2), 10)}.${cleaned.slice(2) || '0'}`;
        }
        if (cleaned.length === 2) {
            return `${cleaned[0]}.${cleaned[1]}`;
        }
        return `${cleaned}.0`;
    };

    const formatCudaLabel = (value) => {
        const normalized = normalizeCudaValue(value);
        if (normalized) {
            return escapeHtml(normalized);
        }
        if (!value) {
            return 'Unknown';
        }
        return escapeHtml(value.toString().replace(/^==/, '').trim());
    };

    const platform = versions?.os || 'Unknown';
    const pythonVersion = versions?.python?.version || 'Unknown';
    const torchVersion = versions?.torch?.version || 'Not installed';
    const cudaVersion = versions?.cuda?.version || 'Not available';
    const cudaDriverPath = versions?.cudaDriver?.path || '';
    const normalizedDriverVersion = normalizeCudaValue(versions?.cudaDriver?.version);
    const cudaDriverVersionDisplay = normalizedDriverVersion || 'Not detected';

    const safePlatform = escapeHtml(platform);
    const safePython = escapeHtml(pythonVersion);
    const safeTorch = escapeHtml(torchVersion);
    const safeCuda = escapeHtml(cudaVersion);
    const safeCudaDriverVersion = escapeHtml(cudaDriverVersionDisplay);
    const safeCudaDriverPath = cudaDriverPath ? escapeHtml(cudaDriverPath) : '';

    const dropdownOptions = pytorchConfigs.map(config => {
        const version = config.version?.replace('==', '') || 'Unknown';
        const cudaLabel = formatCudaLabel(config.cudaVersion || '');
        const isInstalled = torchVersion === version;
        return `<option value="${config.id}" data-version="${version}" ${isInstalled ? 'data-installed="true"' : ''}>PyTorch ${escapeHtml(version)} (CUDA ${cudaLabel})${isInstalled ? ' (Installed)' : ''}</option>`;
    }).join('');
    
    const content = `
        <div class="nitra-version-display">
            <div class="nitra-version-row">
                <span class="nitra-version-label">Platform:</span>
                <span class="nitra-version-value">${safePlatform}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Current Python:</span>
                <span class="nitra-version-value">${safePython}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Current Torch:</span>
                <span class="nitra-version-value">${safeTorch}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Current CUDA:</span>
                <span class="nitra-version-value">${safeCuda}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">CUDA Toolkit (nvcc):</span>
                <span class="nitra-version-value">${safeCudaDriverVersion}</span>
            </div>
            ${safeCudaDriverPath ? `<div class="nitra-version-hint">nvcc path: ${safeCudaDriverPath}</div>` : ''}
        </div>
        
        <label style="display: block; margin-bottom: 8px; color: #f0f0f0; font-weight: 600;">
            Select PyTorch Version:
        </label>
        <select id="nitra-pytorch-dropdown" class="nitra-dropdown">
            ${dropdownOptions}
        </select>
        
        <div id="nitra-pytorch-warning" style="color:#ffffff; font-size: 13px; font-weight:600; margin-bottom:16px; text-align:left;"></div>
        
        <div class="nitra-modal-buttons">
            <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-pytorch-cancel">
                Cancel
            </button>
            <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-pytorch-install">
                Install
            </button>
        </div>
    `;
    
    const { modal, style } = createModalBase('Install PyTorch', content);
    
    const dropdown = modal.querySelector('#nitra-pytorch-dropdown');
    const installBtn = modal.querySelector('#nitra-pytorch-install');
    const warningBox = modal.querySelector('#nitra-pytorch-warning');
    
    // Function to check if selected version is already installed
    const updateInstallButton = () => {
        const selectedOption = dropdown.options[dropdown.selectedIndex];
        const selectedVersion = selectedOption.getAttribute('data-version');
        const selectedConfig = pytorchConfigs.find(c => c.id === selectedOption.value);
        
        // Normalize versions for comparison (remove +cu130 suffixes, etc.)
        const normalizeVersion = (version) => {
            if (!version) {
                return '';
            }
            return version.split('+')[0].split('-')[0]; // Remove build suffixes
        };
        
        const normalizedInstalled = normalizeVersion(torchVersion);
        const normalizedSelected = normalizeVersion(selectedVersion);
        
        // Check if torch version matches
        const torchMatches = normalizedInstalled === normalizedSelected;
        
        // Check if CUDA version matches
        let cudaMatches = false;
        if (selectedConfig?.cudaVersion) {
            const configCuda = selectedConfig.cudaVersion.replace('==', '').replace('>=', '');
            if (selectedConfig.cudaVersion.includes('>=')) {
                // Handle >= comparison
                const minCuda = parseFloat(configCuda);
                const currentCuda = parseFloat(cudaVersion);
                cudaMatches = !isNaN(currentCuda) && !isNaN(minCuda) && currentCuda >= minCuda;
            } else {
                // Exact match
                cudaMatches = cudaVersion === configCuda;
            }
        }
        
        // Both torch and CUDA versions must match
        const isInstalled = torchMatches && cudaMatches;
        
        if (isInstalled) {
            installBtn.disabled = true;
            installBtn.textContent = 'Already Installed';
            installBtn.style.background = '';
            installBtn.style.cursor = '';
        } else {
            installBtn.disabled = false;
            installBtn.textContent = 'Install';
            installBtn.style.background = '';
            installBtn.style.cursor = '';
        }

        const warningLines = [
            'This process will uninstall SageAttention before upgrading PyTorch. Reinstall it after restarting ComfyUI.',
            'Need to update the NVIDIA CUDA toolkit? Use Advanced Tools → CUDA Toolkit Manager to reinstall drivers after this upgrade.',
        ];

        warningBox.innerHTML = warningLines.map(line => escapeHtml(line)).join('<br/><br/>');
    };
    
    // Update button state on dropdown change
    dropdown.addEventListener('change', updateInstallButton);
    updateInstallButton(); // Initial check
    
    modal.querySelector('#nitra-pytorch-cancel').onclick = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
    };
    
    installBtn.onclick = async () => {
        const selectedId = dropdown.value;
        const selectedConfig = pytorchConfigs.find(c => c.id === selectedId);
        
        if (!selectedConfig) {
            alert('Please select a PyTorch version');
            return;
        }
        
        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        
        const result = await installPackage('pytorch', selectedConfig);
        
        if (result.success) {
            alert('PyTorch installed successfully! Please restart ComfyUI.');
            document.body.removeChild(modal);
            document.head.removeChild(style);
        } else {
            alert(`Installation failed: ${result.error || 'Unknown error'}`);
            updateInstallButton(); // Restore button state
        }
    };
    } catch (error) {
        hideLoadingModal();
        alert(`Failed to load PyTorch modal: ${error.message}`);
        console.error('PyTorch modal error:', error);
    }
}

export async function showCudaToolkitModal() {
    try {
        const versions = await getCurrentVersions();
        const platform = (versions?.os || 'Unknown').trim();
        const platformLower = platform.toLowerCase();
        const isLinux = platformLower.includes('linux');
        const isWindows = platformLower.includes('windows');
        const isSupported = isLinux || isWindows;
        const torchCudaVersion = versions?.cuda?.version || null;
        const driverVersion = versions?.cudaDriver?.version || 'Not detected';
        const driverPath = versions?.cudaDriver?.path || '';

        const dropdownOptions = [
            `<option value="auto">Install latest available</option>`,
        ];

        if (torchCudaVersion) {
            dropdownOptions.push(
                `<option value="${escapeHtml(torchCudaVersion)}">Match PyTorch CUDA (${escapeHtml(torchCudaVersion)})</option>`
            );
        }
        if (driverVersion && driverVersion !== torchCudaVersion && driverVersion !== 'Not detected') {
            dropdownOptions.push(
                `<option value="${escapeHtml(driverVersion)}">Match current nvcc (${escapeHtml(driverVersion)})</option>`
            );
        }

        const content = `
            <div class="nitra-version-display">
                <div class="nitra-version-row">
                    <span class="nitra-version-label">Platform:</span>
                    <span class="nitra-version-value">${escapeHtml(platform)}</span>
                </div>
                <div class="nitra-version-row">
                    <span class="nitra-version-label">PyTorch CUDA:</span>
                    <span class="nitra-version-value">${escapeHtml(torchCudaVersion || 'Not detected')}</span>
                </div>
                <div class="nitra-version-row">
                    <span class="nitra-version-label">nvcc (driver):</span>
                    <span class="nitra-version-value">${escapeHtml(driverVersion || 'Not detected')}</span>
                </div>
                ${driverPath ? `<div class="nitra-version-hint">nvcc path: ${escapeHtml(driverPath)}</div>` : ''}
                <div class="nitra-version-hint" style="margin-top: 4px;">
                    If you just installed a new toolkit version, the path wont update until you open ComfyUI in a new shell.
                </div>
            </div>

            <div class="nitra-advanced-warning" style="
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid rgba(239, 68, 68, 0.4);
                padding: 12px;
                border-radius: 10px;
                margin-bottom: 16px;
                color: #fca5a5;
                font-size: 0.9em;
            ">
                ${isWindows 
                    ? 'On Windows, this will use <code>winget</code> to install the CUDA Toolkit. You may see a UAC prompt to allow the installation.' 
                    : 'CUDA toolkit automation is currently available on Linux and Windows hosts. This process removes existing CUDA/Nsight packages and reinstalls the requested toolkit.'}
            </div>

            <label style="display:block; margin-bottom:8px; color:#f0f0f0; font-weight:600;">
                Target CUDA Toolkit
            </label>
            <select id="nitra-cuda-target-select" class="nitra-dropdown">
                ${dropdownOptions.join('')}
            </select>

            <div style="margin-top:12px;">
                <label for="nitra-cuda-custom-input" style="color:#f0f0f0; font-size:0.9em;">Custom version (optional):</label>
                <input id="nitra-cuda-custom-input" class="nitra-input" placeholder="e.g., 12.8.0" style="margin-top:6px;" />
            </div>

            <p style="color:#94a3b8; font-size:0.85em; margin-top:12px;">
                Tip: Use “Match PyTorch CUDA” after upgrading PyTorch, or rerun with “Install latest” if CUDA becomes corrupted.
                ${isWindows ? '<br/><a href="https://developer.nvidia.com/cuda-toolkit-archive" target="_blank" style="color:#4a9eff;">View CUDA Archive</a>' : ''}
            </p>

            <div class="nitra-modal-buttons">
                <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-cuda-cancel">
                    Cancel
                </button>
                <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-cuda-install">
                    ${isSupported ? 'Install / Update CUDA' : 'Unsupported OS'}
                </button>
            </div>
        `;

        const { modal, style } = createModalBase('CUDA Toolkit Manager', content);

        const cancelBtn = modal.querySelector('#nitra-cuda-cancel');
        const installBtn = modal.querySelector('#nitra-cuda-install');
        const targetSelect = modal.querySelector('#nitra-cuda-target-select');
        const customInput = modal.querySelector('#nitra-cuda-custom-input');

        cancelBtn.onclick = () => {
            document.body.removeChild(modal);
            document.head.removeChild(style);
        };

        if (!isSupported) {
            installBtn.disabled = true;
        } else {
            installBtn.onclick = async () => {
                const customValue = customInput.value.trim();
                let targetVersion = customValue || (targetSelect.value !== 'auto' ? targetSelect.value : null);

                installBtn.disabled = true;
                installBtn.textContent = 'Running...';

                const result = await installPackage('cuda-toolkit', {
                    targetVersion: targetVersion,
                });

                if (result.success) {
                    alert(result.message || 'CUDA Toolkit installation completed. Please restart ComfyUI.');
                    document.body.removeChild(modal);
                    document.head.removeChild(style);
                } else {
                    alert(result.error || 'Failed to install CUDA Toolkit.');
                    installBtn.disabled = false;
                    installBtn.textContent = 'Install / Update CUDA';
                }
            };
        }
    } catch (error) {
        console.error('Error loading CUDA Toolkit modal:', error);
        alert('Failed to load CUDA Toolkit Manager. Please try again.');
    }
}

export async function showBuildToolsModal() {
    try {
        const versions = await getCurrentVersions();
        const platform = (versions?.os || 'Unknown').trim();
        const isWindows = platform.toLowerCase().includes('windows');
        const isInstalled = versions?.vs_build_tools?.installed === true;
        
        // VS Build Tools version isn't always reliably detectable via simple checks, 
        // but nitra_server.py tries `winget list`.
        const versionDisplay = isInstalled ? 'Detected' : 'Not detected';

        const content = `
            <div class="nitra-version-display">
                <div class="nitra-version-row">
                    <span class="nitra-version-label">Platform:</span>
                    <span class="nitra-version-value">${escapeHtml(platform)}</span>
                </div>
                <div class="nitra-version-row">
                    <span class="nitra-version-label">VS Build Tools Status:</span>
                    <span class="nitra-version-value" style="${isInstalled ? 'color:#4CAF50; font-weight:bold;' : 'color:#fca5a5'}">${escapeHtml(versionDisplay)}</span>
                </div>
            </div>

            <div class="nitra-advanced-warning" style="
                background: rgba(59, 130, 246, 0.1);
                border: 1px solid rgba(59, 130, 246, 0.4);
                padding: 12px;
                border-radius: 10px;
                margin-bottom: 16px;
                color: #93c5fd;
                font-size: 0.9em;
            ">
                Installs <strong>Microsoft Visual Studio 2022 Build Tools</strong> with "Desktop development with C++" workload. This is required for compiling python wheels with C++ code from source.
            </div>
            
            <p style="color:#94a3b8; font-size:0.85em; margin-bottom:12px;">
                Note: This will launch an external installer window. You may need to accept a User Account Control (UAC) prompt.
            </p>

            <div class="nitra-modal-buttons">
                <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-vs-cancel">
                    Cancel
                </button>
                <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-vs-install">
                    ${isWindows ? (isInstalled ? 'Reinstall / Update' : 'Install Build Tools') : 'Windows Only'}
                </button>
            </div>
        `;

        const { modal, style } = createModalBase('Microsoft Build Tools', content);

        const cancelBtn = modal.querySelector('#nitra-vs-cancel');
        const installBtn = modal.querySelector('#nitra-vs-install');

        cancelBtn.onclick = () => {
            document.body.removeChild(modal);
            document.head.removeChild(style);
        };

        if (!isWindows) {
            installBtn.disabled = true;
        } else {
            installBtn.onclick = async () => {
                installBtn.disabled = true;
                installBtn.textContent = 'Starting Installer...';

                const result = await installPackage('vs-build-tools', {});

                if (result.success) {
                    alert(result.message || 'Visual Studio Build Tools installed successfully. You may need to reboot.');
                    document.body.removeChild(modal);
                    document.head.removeChild(style);
                } else {
                    alert(result.error || 'Failed to install Build Tools.');
                    installBtn.disabled = false;
                    installBtn.textContent = isInstalled ? 'Reinstall / Update' : 'Install Build Tools';
                }
            };
        }

    } catch (error) {
        console.error('Error loading Build Tools modal:', error);
        alert('Failed to load Build Tools Manager. Please try again.');
    }
}

export async function showBuildToolsShellModal() {
    try {
        const versions = await getCurrentVersions();
        const platform = (versions?.os || 'Unknown').trim();
        const isWindows = platform.toLowerCase().includes('windows');
        const vsDetected = versions?.vs_build_tools?.installed === true;

        const content = `
            <div class="nitra-version-display">
                <div class="nitra-version-row">
                    <span class="nitra-version-label">Platform:</span>
                    <span class="nitra-version-value">${escapeHtml(platform)}</span>
                </div>
                <div class="nitra-version-row">
                    <span class="nitra-version-label">VS Build Tools:</span>
                    <span class="nitra-version-value" style="${vsDetected ? 'color:#4CAF50; font-weight:bold;' : 'color:#fca5a5'}">
                        ${vsDetected ? 'Detected' : 'Not detected'}
                    </span>
                </div>
            </div>

            <div class="nitra-advanced-warning" style="
                background: rgba(59, 130, 246, 0.1);
                border: 1px solid rgba(59, 130, 246, 0.4);
                padding: 12px;
                border-radius: 10px;
                margin-bottom: 16px;
                color: #93c5fd;
                font-size: 0.9em;
            ">
                Opens a new Developer Command Prompt pre-configured with the Visual Studio Build Tools environment.<br/>
                Use this shell to manually run <code>pip install</code>, <code>cmake</code>, or other native tooling.
            </div>

            <p style="color:#94a3b8; font-size:0.85em; margin-bottom:12px;">
                A new console window will appear. Close it when finished. You may be prompted by UAC.
            </p>

            <div class="nitra-modal-buttons">
                <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-vs-shell-cancel">
                    Cancel
                </button>
                <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-vs-shell-open">
                    ${isWindows ? (vsDetected ? 'Open Build Tools Shell' : 'Install Build Tools First') : 'Windows Only'}
                </button>
            </div>
        `;

        const { modal, style } = createModalBase('Open Build Tools Shell', content);

        const cancelBtn = modal.querySelector('#nitra-vs-shell-cancel');
        const openBtn = modal.querySelector('#nitra-vs-shell-open');

        cancelBtn.onclick = () => {
            document.body.removeChild(modal);
            document.head.removeChild(style);
        };

        if (!isWindows || !vsDetected) {
            openBtn.disabled = true;
            return;
        }

        openBtn.onclick = async () => {
            openBtn.disabled = true;
            openBtn.textContent = 'Opening Shell...';

            const result = await installPackage('vs-build-shell', {});
            if (result.success) {
                alert(result.message || 'Build Tools shell opened.');
                document.body.removeChild(modal);
                document.head.removeChild(style);
            } else {
                alert(result.error || 'Failed to open Build Tools shell.');
                openBtn.disabled = false;
                openBtn.textContent = 'Open Build Tools Shell';
            }
        };
    } catch (error) {
        console.error('Error loading Build Tools Shell modal:', error);
        alert('Failed to open Build Tools Shell launcher.');
    }
}

// SageAttention Modal: Show 5 versions, match with database, green/red text for availability
export async function showSageAttentionModal() {
    const loadingModal = showLoadingModal();
    
    try {
        const versions = await getCurrentVersions();
        const configs = await fetchComfyConfigs();
        const sageConfigs = configs.filter(c => c.category === 'sageattention');
        
        hideLoadingModal();
    
    const platform = versions?.os || 'Unknown';
    const pythonVersion = versions?.python?.version || 'Unknown';
    const torchVersion = versions?.torch?.version || 'Not installed';
    const cudaVersion = versions?.cuda?.version || 'Not available';
    
    // OS-specific logic
    const isMac = platform.toLowerCase().includes('mac') || platform.toLowerCase().includes('darwin');
    const isLinux = platform.toLowerCase().includes('linux');
    const isWindows = platform.toLowerCase().includes('windows');
    
    // Get Triton version based on OS
    const tritonVersion = isWindows 
        ? (versions?.windows_triton?.version || 'Not installed')
        : (versions?.triton?.version || 'Not installed');
    
    const sageVersion = versions?.sageattention?.version || 'Not installed';
    
    let availabilityClass = '';
    let availabilityText = '';
    let canInstall = false;
    let matchingConfig = null; // Initialize matchingConfig for all OS types
    
    if (isMac) {
        // macOS: Not supported
        availabilityClass = 'nitra-availability-unavailable';
        availabilityText = ' SageAttention is not supported on macOS';
        canInstall = false;
    } else if (isLinux) {
        // Linux: Compile from source
        // Check if latest version (2.2.0) is already installed
        const latestVersion = '2.2.0';
        const installedVersion = sageVersion.split('+')[0]; // Remove build info if present
        const isLatestInstalled = installedVersion === latestVersion;
        
        if (isLatestInstalled) {
            availabilityClass = 'nitra-availability-available';
            availabilityText = ' Latest version (2.2.0) is already installed';
            canInstall = false; // Disable install button
        } else {
            availabilityClass = 'nitra-availability-available';
            availabilityText = ' Will compile from source (https://github.com/thu-ml/SageAttention.git)<br/> Compilation may take up to 20 minutes';
            canInstall = true;
        }
    } else if (isWindows) {
        // Windows: Use precompiled wheel or PyPI
        matchingConfig = sageConfigs.find(config => {
            const configTorch = config.torchVersion?.replace('==', '');
            const configCuda = config.cudaVersion?.replace('==', '');
            return torchVersion.startsWith(configTorch) && cudaVersion === configCuda;
        });
        
        const hasMatch = !!matchingConfig;
        const hasTriton = tritonVersion !== 'Not installed';
        
        if (!hasTriton) {
            availabilityClass = 'nitra-availability-unavailable';
            availabilityText = ' Triton Windows must be installed first';
            canInstall = false;
        } else if (hasMatch) {
            availabilityClass = 'nitra-availability-available';
            availabilityText = ' Matching precompiled version available';
            canInstall = true;
        } else {
            availabilityClass = 'nitra-availability-unavailable';
            availabilityText = ' No matching precompiled version (will use PyPI fallback)';
            canInstall = true; // Still allow installation with PyPI fallback
        }
    } else {
        // Unknown OS
        availabilityClass = 'nitra-availability-unavailable';
        availabilityText = ' Unknown operating system';
        canInstall = false;
    }
    
    // Check if already installed
    let isAlreadyInstalled = false;
    
    if (isLinux) {
        // For Linux, check against latest known version (2.2.0)
        const latestVersion = '2.2.0';
        const installedVersion = sageVersion.split('+')[0];
        isAlreadyInstalled = installedVersion === latestVersion;
    } else if (isWindows) {
        // For Windows, check against matching config
        const installedVersion = sageVersion.split('+')[0];
        const targetVersion = matchingConfig?.version?.replace('==', '') || '1.0.6';
        isAlreadyInstalled = installedVersion === targetVersion;
    }
    
    const content = `
        <div class="nitra-version-display">
            <div class="nitra-version-row">
                <span class="nitra-version-label">Platform:</span>
                <span class="nitra-version-value" style="${isMac ? 'color: #ff4444; font-weight: bold;' : ''}">${platform}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Python Version:</span>
                <span class="nitra-version-value">${pythonVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">PyTorch Version:</span>
                <span class="nitra-version-value">${torchVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">CUDA Version:</span>
                <span class="nitra-version-value">${cudaVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">${isWindows ? 'Triton-Windows Version:' : 'Triton Version:'}</span>
                <span class="nitra-version-value">${tritonVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">SageAttention Version:</span>
                <span class="nitra-version-value">${sageVersion}</span>
            </div>
        </div>
        
        <div class="nitra-availability-check ${availabilityClass}">
            ${availabilityText}
        </div>
        
        <div class="nitra-modal-buttons">
            <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-sage-cancel">
                Cancel
            </button>
            <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-sage-install" ${!canInstall || isAlreadyInstalled ? 'disabled' : ''}>
                ${isMac ? 'Not Supported on macOS' : !canInstall ? 'Cannot Install' : isAlreadyInstalled ? 'Already Installed' : 'Install'}
            </button>
        </div>
    `;
    
    const { modal, style } = createModalBase('Install SageAttention', content);
    
    const installBtn = modal.querySelector('#nitra-sage-install');
    
    // Apply disabled styling if needed
    if (!canInstall || isAlreadyInstalled) {
        installBtn.style.background = '';
        installBtn.style.cursor = '';
    }
    
    modal.querySelector('#nitra-sage-cancel').onclick = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
    };
    
    installBtn.onclick = async () => {
        if (!canInstall || isAlreadyInstalled) return;
        
        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        
        const configToUse = matchingConfig || { packageSource: 'sageattention==1.0.6' };
        const result = await installPackage('sageattention', configToUse);
        
        if (result.success) {
            alert('SageAttention installed successfully! Please restart ComfyUI.');
            document.body.removeChild(modal);
            document.head.removeChild(style);
        } else {
            alert(`Installation failed: ${result.error || 'Unknown error'}`);
            installBtn.disabled = false;
            installBtn.textContent = 'Install';
        }
    };
    } catch (error) {
        hideLoadingModal();
        alert(`Failed to load SageAttention modal: ${error.message}`);
        console.error('SageAttention modal error:', error);
    }
}

// ONNX Modal: Simple modal showing current versions, Install/Cancel buttons
export async function showONNXModal() {
    const loadingModal = showLoadingModal();
    
    try {
        const versions = await getCurrentVersions();
        const configs = await fetchComfyConfigs();
        
        hideLoadingModal();
    const onnxConfigs = configs.filter(c => c.category === 'onnxruntime-gpu');
    const onnxBaseConfigs = configs.filter(c => c.category === 'onnx');
    
    const platform = versions?.os || 'Unknown';
    const pythonVersion = versions?.python?.version || 'Unknown';
    const onnxVersion = versions?.onnx?.version || 'Not installed';
    const onnxruntimeVersion = versions?.onnxruntime?.version || 'Not installed';
    const onnxruntimeGpuVersion = versions?.onnxruntime_gpu?.version || 'Not installed';
    
    // Get latest available versions from configs
    const latestOnnxRuntimeConfig = onnxConfigs[0];
    const latestOnnxBaseConfig = onnxBaseConfigs[0];
    const latestOnnxRuntimeVersion = latestOnnxRuntimeConfig?.version?.replace('==', '').trim() || 'Unknown';
    const latestOnnxBaseVersion = latestOnnxBaseConfig?.version?.replace('==', '').trim() || 'Unknown';
    
    // Fallback: try to get latest versions from server-side data
    const serverLatestOnnxRuntime = versions?.onnxruntime_gpu?.latest_version;
    const serverLatestOnnxBase = versions?.onnx?.latest_version;
    
    // Final fallback: fetch from PyPI if both configs and server data are unavailable
    let finalLatestOnnxRuntimeVersion = latestOnnxRuntimeVersion !== 'Unknown' ? latestOnnxRuntimeVersion : serverLatestOnnxRuntime;
    let finalLatestOnnxBaseVersion = latestOnnxBaseVersion !== 'Unknown' ? latestOnnxBaseVersion : serverLatestOnnxBase;
    
    // If still unknown, fetch from PyPI
    if (finalLatestOnnxRuntimeVersion === 'Unknown' || !finalLatestOnnxRuntimeVersion) {
        finalLatestOnnxRuntimeVersion = await getPyPIVersion('onnxruntime-gpu');
    }
    
    if (finalLatestOnnxBaseVersion === 'Unknown' || !finalLatestOnnxBaseVersion) {
        finalLatestOnnxBaseVersion = await getPyPIVersion('onnx');
    }
    
    // Determine button state based on onnxruntime-gpu (main package)
    let buttonText = 'Install';
    let isDisabled = false;
    
    if (onnxruntimeGpuVersion !== 'Not installed') {
        // Check if update is available
        if (finalLatestOnnxRuntimeVersion !== 'Unknown' && onnxruntimeGpuVersion === finalLatestOnnxRuntimeVersion) {
            buttonText = 'Already Up to Date';
            isDisabled = true;
        } else {
            buttonText = 'Upgrade';
        }
    }
    
    const content = `
        <div class="nitra-version-display">
            <div class="nitra-version-row">
                <span class="nitra-version-label">Platform:</span>
                <span class="nitra-version-value">${platform}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Python Version:</span>
                <span class="nitra-version-value">${pythonVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">ONNX Version:</span>
                <span class="nitra-version-value">${onnxVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">ONNX Latest Available:</span>
                <span class="nitra-version-value">${finalLatestOnnxBaseVersion !== 'Unknown' ? finalLatestOnnxBaseVersion : 'Unknown'}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">ONNX Runtime (CPU):</span>
                <span class="nitra-version-value" style="${onnxruntimeVersion === 'Not installed' ? 'color: #4CAF50;' : ''}">
                    ${onnxruntimeVersion === 'Not installed' ? ' Not installed' : onnxruntimeVersion}
                </span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">ONNX Runtime GPU:</span>
                <span class="nitra-version-value">${onnxruntimeGpuVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">ONNX Runtime GPU Latest Available:</span>
                <span class="nitra-version-value">${finalLatestOnnxRuntimeVersion !== 'Unknown' ? finalLatestOnnxRuntimeVersion : 'Unknown'}</span>
            </div>
        </div>
        
        <p style="color: #A0BBC4; margin-bottom: 20px;">
            This will uninstall onnxruntime (CPU) and install/upgrade onnxruntime-gpu and onnx for GPU acceleration.
        </p>
        
        <div class="nitra-modal-buttons">
            <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-onnx-cancel">
                Cancel
            </button>
            <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-onnx-install" ${isDisabled ? 'disabled' : ''}>
                ${buttonText}
            </button>
        </div>
    `;
    
    const { modal, style } = createModalBase('ONNX Fix (Fix Slow Pose and Depth)', content);
    
    const installBtn = modal.querySelector('#nitra-onnx-install');
    
    // Apply disabled styling if needed
    if (isDisabled) {
        installBtn.style.background = '';
        installBtn.style.cursor = '';
    }
    
    modal.querySelector('#nitra-onnx-cancel').onclick = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
    };
    
    installBtn.onclick = async () => {
        if (isDisabled) return;
        
        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        
        const result = await installPackage('onnxruntime-gpu', latestOnnxRuntimeConfig || {});
        
        if (result.success) {
            alert('ONNX Runtime GPU installed successfully! Please restart ComfyUI.');
            document.body.removeChild(modal);
            document.head.removeChild(style);
        } else {
            alert(`Installation failed: ${result.error || 'Unknown error'}`);
            installBtn.disabled = false;
            installBtn.textContent = buttonText;
        }
    };
    } catch (error) {
        hideLoadingModal();
        alert(`Failed to load ONNX modal: ${error.message}`);
        console.error('ONNX modal error:', error);
    }
}

// Triton-Windows Modal: Show versions, button shows Install/Update/Grayed-out based on status
export async function showTritonWindowsModal() {
    const loadingModal = showLoadingModal();
    
    try {
        const versions = await getCurrentVersions();
        
        hideLoadingModal();
        
        const platform = versions?.os || 'Unknown';
        
        // Check if Linux - show informational message
        if (platform.toLowerCase() === 'linux') {
            const tritonVersion = versions?.triton?.version || 'Not installed';
            
            const content = `
                <div class="nitra-version-display">
                    <div class="nitra-version-row">
                        <span class="nitra-version-label">Platform:</span>
                        <span class="nitra-version-value">${platform}</span>
                    </div>
                    <div style="margin-top: 20px; padding: 15px; background: #2a2a2a; border-radius: 5px; border-left: 3px solid #4a9eff;">
                        <p style="margin: 0 0 10px 0; color: #4a9eff; font-weight: bold;"> Information</p>
                        <p style="margin: 0; line-height: 1.5;">
                            Triton-Windows is a Windows-only package. Linux systems use the standard <code>triton</code> package, 
                            which is automatically installed with PyTorch.
                        </p>
                        <p style="margin: 10px 0 0 0; line-height: 1.5;">
                            <strong>Current Triton version:</strong> ${tritonVersion}
                        </p>
                    </div>
                </div>
                
                <div class="nitra-modal-buttons">
                    <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-triton-cancel">
                        Close
                    </button>
                </div>
            `;
            
            const { modal, style } = createModalBase('Triton Information', content);
            
            modal.querySelector('#nitra-triton-cancel').onclick = () => {
                document.body.removeChild(modal);
                document.head.removeChild(style);
            };
            
            return;
        }
        
        const configs = await fetchComfyConfigs();
        const tritonConfigs = configs.filter(c => c.category === 'triton-windows');
    
    const pythonVersion = versions?.python?.version || 'Unknown';
    const torchVersion = versions?.torch?.version || 'Not installed';
    const cudaVersion = versions?.cuda?.version || 'Not available';
    const tritonVersion = (versions?.windows_triton?.version || 'Not installed').trim();
    
    // Match with database based on torch and CUDA versions
    const matchingConfig = tritonConfigs.find(config => {
        const configTorch = config.torchVersion?.replace('==', '');
        const configCuda = config.cudaVersion?.replace('>=', '').replace('==', '');
        
        // Check if torch version matches
        const torchMatches = torchVersion.startsWith(configTorch);
        
        // Check if CUDA version matches (handle >= comparisons)
        let cudaMatches = false;
        if (config.cudaVersion?.includes('>=')) {
            // Handle >= comparison
            const minCuda = parseFloat(configCuda);
            const currentCuda = parseFloat(cudaVersion);
            cudaMatches = !isNaN(currentCuda) && !isNaN(minCuda) && currentCuda >= minCuda;
        } else {
            // Exact match
            cudaMatches = cudaVersion === configCuda;
        }
        
        return torchMatches && cudaMatches;
    });
    
    const latestVersion = matchingConfig?.version?.replace('==', '').trim() || 'Unknown';
    
    let buttonText = 'Install';
    let isDisabled = false;
    
    if (tritonVersion !== 'Not installed') {
        if (tritonVersion === latestVersion) {
            buttonText = 'Already Up to Date';
            isDisabled = true;
        } else {
            buttonText = 'Update';
        }
    }
    
    const content = `
        <div class="nitra-version-display">
            <div class="nitra-version-row">
                <span class="nitra-version-label">Platform:</span>
                <span class="nitra-version-value">${platform}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Python Version:</span>
                <span class="nitra-version-value">${pythonVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Torch Version:</span>
                <span class="nitra-version-value">${torchVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">CUDA Version:</span>
                <span class="nitra-version-value">${cudaVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Triton-Windows Version:</span>
                <span class="nitra-version-value">${tritonVersion}</span>
            </div>
            <div class="nitra-version-row">
                <span class="nitra-version-label">Latest Available:</span>
                <span class="nitra-version-value">${latestVersion}</span>
            </div>
            
            ${platform.toLowerCase() === 'windows' ? `
            <div style="margin-top: 20px; padding: 15px; background: #2a2a2a; border-radius: 5px; border-left: 3px solid #ffc107;">
                <p style="margin: 0 0 10px 0; color: #ffc107; font-weight: bold;"> Required Before Installation</p>
                <p style="margin: 0; line-height: 1.5;">
                    Installing Triton-Windows requires the Microsoft Visual C++ Redistributable. 
                    Please download and install it from the link below before installing Triton-Windows:
                </p>
                <p style="margin: 10px 0 0 0;">
                    <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" target="_blank" style="color: #4a9eff; text-decoration: underline;">
                        Download Visual C++ Redistributable
                    </a>
                </p>
            </div>
            ` : ''}
        </div>
        
        <div class="nitra-modal-buttons">
            <button class="nitra-modal-btn nitra-modal-btn-secondary" id="nitra-triton-cancel">
                Cancel
            </button>
            <button class="nitra-modal-btn nitra-modal-btn-primary" id="nitra-triton-install" ${isDisabled ? 'disabled' : ''}>
                ${buttonText}
            </button>
        </div>
    `;
    
    const { modal, style } = createModalBase('Install Triton Windows', content);
    
    const installBtn = modal.querySelector('#nitra-triton-install');
    
    // Apply disabled styling if needed
    if (isDisabled) {
        installBtn.style.background = '';
        installBtn.style.cursor = '';
    }
    
    modal.querySelector('#nitra-triton-cancel').onclick = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
    };
    
    if (!isDisabled) {
        modal.querySelector('#nitra-triton-install').onclick = async () => {
            const installBtn = modal.querySelector('#nitra-triton-install');
            installBtn.disabled = true;
            installBtn.textContent = 'Installing...';
            
            const result = await installPackage('triton-windows', matchingConfig);
            
            if (result.success) {
                alert('Triton Windows installed successfully! Please restart ComfyUI.');
                document.body.removeChild(modal);
                document.head.removeChild(style);
            } else {
                alert(`Installation failed: ${result.error || 'Unknown error'}`);
                installBtn.disabled = false;
                installBtn.textContent = buttonText;
            }
        };
    }
    } catch (error) {
        hideLoadingModal();
        console.error('Error in showTritonWindowsModal:', error);
        alert('Error opening Triton Windows modal: ' + error.message);
    }
}

