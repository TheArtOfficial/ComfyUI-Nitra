// Main authenticated interface
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { formatLicenseStatus, initializeLicenseStatus } from '../license/status.js';
import { logoutWebsite } from '../auth/logout.js';
import { updateListHeights } from './layout.js';
import { loadWorkflows, checkWorkflowsForHFTokenRequirement } from '../workflows/api.js';
import { renderWorkflows } from '../workflows/ui.js';
import { updateWorkflowInstallButton } from '../workflows/selection.js';
import { pollForWorkflowCompletion, cancelWorkflowInstall, resetWorkflowInstallButton } from '../workflows/installation.js';
import { loadModels } from '../models/api.js';
import { renderModels } from '../models/ui.js';
import { updateModelDownloadButton } from '../models/selection.js';
import { pollForModelCompletion, cancelModelDownload, resetModelDownloadButton } from '../models/download.js';
import { updateDialogForLogin } from './dialog.js';
import { createCloseButton } from './components/CloseButton.js';
import { handleOptimizerUpdate, handleOptimizerUpdateNitra, handleOptimizerRestart, handleOptimizerRefresh } from '../optimizer/handlers.js';
import { showPyTorchModal, showSageAttentionModal, showONNXModal, showTritonWindowsModal, showCudaToolkitModal, showBuildToolsModal, showBuildToolsShellModal } from '../optimizer/package-modals.js';
import { showHuggingFaceTokenPrompt } from './systemPrompts.js';
import { getDeviceIdentity, fetchRegisteredDevices, registerCurrentDevice } from '../device/api.js';

let lastActiveTab = 'optimizer';

export function createUpdateInterface() {
    const updatePanel = document.createElement("div");
    initializeLicenseStatus().catch((error) => {
        console.warn('Nitra: Failed to initialize license status', error);
    });

    updatePanel.className = "nitra-update-interface";
    updatePanel.style.cssText = `
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        flex: 1;
        overflow: hidden;
    `;

    const escapeHtml = (value = '') => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    let deviceSectionInitialized = false;

    function renderDeviceIdentity(identity) {
        const container = updatePanel.querySelector('#nitra-device-identity');
        if (!container) return;

        if (!identity) {
            container.innerHTML = `<p style="color:#bdbdbd;">Unable to detect this machine.</p>`;
            return;
        }

        container.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.85em; color:#d1d5db;">
                <span><strong>Machine:</strong> ${escapeHtml(identity.machine_name || 'Unknown')}</span>
                <span><strong>Host:</strong> ${escapeHtml(identity.hostname || 'Unknown')}</span>
                <span><strong>Platform:</strong> ${escapeHtml(identity.platform || '-')}&nbsp;${escapeHtml(identity.platform_release || '')}</span>
                <span><strong>Architecture:</strong> ${escapeHtml(identity.architecture || '-')}</span>
            </div>
        `;

        const labelInput = updatePanel.querySelector('#nitra-device-label-input');
        if (labelInput && !labelInput.value) {
            labelInput.value = identity.default_label || identity.machine_name || '';
        }
    }

    window.addEventListener('nitra:device-registered', () => {
        getDeviceIdentity(true)
            .then((identity) => {
                renderDeviceIdentity(identity);
                return fetchRegisteredDevices();
            })
            .then((registrations) => {
                return getDeviceIdentity().then((identity) => {
                    renderDeviceList(identity, registrations);
                });
            })
            .catch((error) => {
                console.warn('Nitra: Failed to refresh device state after registration', error);
            });
    });

    function renderDeviceList(identity, registrations) {
        const listContainer = updatePanel.querySelector('#nitra-device-list');
        const slotsLabel = updatePanel.querySelector('#nitra-device-slots');
        if (!listContainer) return;

        if (!registrations) {
            if (slotsLabel) {
                slotsLabel.textContent = 'Machine slots used: --/--';
            }
            listContainer.innerHTML = `
                <div style="padding:12px; border:1px dashed rgba(255,255,255,0.2); border-radius:8px; color:#fca5a5; font-size:0.85em;">
                    Unable to fetch registered devices. Please try again.
                </div>
            `;
            return;
        }

        const devices = Array.isArray(registrations?.devices) ? registrations.devices : [];
        const maxSlots = registrations?.maxSlots ?? 2;
        if (slotsLabel) {
            slotsLabel.textContent = `Machine slots used: ${devices.length}/${maxSlots}`;
        }

        if (!devices.length) {
            listContainer.innerHTML = `
                <div style="padding:12px; border:1px dashed rgba(255,255,255,0.2); border-radius:8px; color:#bdbdbd; font-size:0.85em;">
                    No machines are currently registered. Register this device to continue.
                </div>
            `;
            return;
        }

        const currentHash = identity?.fingerprint_hash;
        listContainer.innerHTML = devices.map(device => {
            const isCurrent = currentHash && device.fingerprintHash && currentHash === device.fingerprintHash;
            const lastSeen = device.lastSeenAt || device.lastLoginAt || device.createdAt || 'Unknown';
            const machineLabel = device.deviceLabel || device.machineName || 'Registered Device';
            const platformLabel = [device.platform, device.osVersion].filter(Boolean).join(' ');
            return `
                <div style="border:1px solid rgba(255,255,255,0.15); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:4px; background:rgba(255,255,255,0.02);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="color:#ffffff; font-weight:600;">${escapeHtml(machineLabel)}</div>
                        ${isCurrent ? '<span style="background:#4ade80; color:#0f172a; padding:2px 10px; border-radius:999px; font-size:0.7em; font-weight:700;">This machine</span>' : ''}
                    </div>
                    <div style="color:#bdbdbd; font-size:0.8em;">${escapeHtml(device.machineName || 'Unknown')} • ${escapeHtml(platformLabel || '-')}</div>
                    <div style="color:#94a3b8; font-size:0.75em;">Last seen: ${escapeHtml(lastSeen)}</div>
                </div>
            `;
        }).join('');
    }

    async function loadDeviceManagementSection(forceRefresh = false) {
        const section = updatePanel.querySelector('#nitra-device-management');
        if (!section) {
            return;
        }
        if (!state.currentUser?.apiToken) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        const statusEl = section.querySelector('#nitra-device-status');
        const refreshBtn = section.querySelector('#nitra-refresh-device-btn');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(255,255,255,0.05)';
            statusEl.style.border = '1px solid rgba(255,255,255,0.08)';
            statusEl.style.color = '#bdbdbd';
            statusEl.textContent = 'Loading device information...';
        }
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
        }

        try {
            const identity = await getDeviceIdentity(forceRefresh);
            let registrations = null;
            try {
                registrations = await fetchRegisteredDevices();
            } catch (regError) {
                console.warn('Nitra: Failed to fetch registered devices', regError);
            }
            renderDeviceIdentity(identity);
            renderDeviceList(identity, registrations);
            if (statusEl) {
                statusEl.style.display = 'none';
            }
        } catch (error) {
            console.error('Nitra: Failed to load device information', error);
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                statusEl.style.color = '#fca5a5';
                statusEl.textContent = 'Unable to load device information. Please try again.';
            }
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = 'Refresh';
            }
            deviceSectionInitialized = true;
        }
    }

    function setupDeviceManagementEvents() {
        const refreshBtn = updatePanel.querySelector('#nitra-refresh-device-btn');
        if (refreshBtn && !refreshBtn.dataset.bound) {
            refreshBtn.dataset.bound = 'true';
            refreshBtn.addEventListener('click', () => loadDeviceManagementSection(true));
        }

        const registerBtn = updatePanel.querySelector('#nitra-register-device-btn');
        if (registerBtn && !registerBtn.dataset.bound) {
            registerBtn.dataset.bound = 'true';
            registerBtn.addEventListener('click', async () => {
                if (!state.currentUser?.apiToken) {
                    alert('You must be logged in to register this device.');
                    return;
                }

                const section = updatePanel.querySelector('#nitra-device-management');
                const statusEl = section?.querySelector('#nitra-device-status');
                const labelInput = section?.querySelector('#nitra-device-label-input');
                const label = labelInput?.value?.trim();

                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(255,255,255,0.05)';
                    statusEl.style.border = '1px solid rgba(255,255,255,0.08)';
                    statusEl.style.color = '#bdbdbd';
                    statusEl.textContent = 'Registering device...';
                }

                try {
                    await registerCurrentDevice({
                        deviceLabel: label || undefined,
                        clientTimestamp: new Date().toISOString()
                    });
                    if (statusEl) {
                        statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
                        statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                        statusEl.style.color = '#6ee7b7';
                        statusEl.textContent = 'Device registered successfully.';
                    }
                    await loadDeviceManagementSection(true);
                } catch (error) {
                    if (error?.status === 409 && error?.response?.requiresConfirmation) {
                        const registeredDevices = error.response.registeredDevices || [];
                        const replacementId = error.response.deviceToReplace || registeredDevices[0]?.deviceId;
                        const deviceNames = registeredDevices.map(device => device.deviceLabel || device.machineName || 'Device');
                        const confirmMessage = [
                            `You already have ${registeredDevices.length} machines registered (${deviceNames.join(', ')})`,
                            'Registering this machine will revoke access for the oldest device.',
                            '',
                            'Allowing access to multiple users under one account is against the Terms & Conditions of ComfyUI-Nitra and may result in your account being banned.',
                            '',
                            'Do you want to continue?'
                        ].join('\n');
                        const confirmed = window.confirm(confirmMessage);
                        if (confirmed && replacementId) {
                            try {
                                await registerCurrentDevice({
                                    deviceLabel: label || undefined,
                                    replaceDeviceId: replacementId,
                                    clientTimestamp: new Date().toISOString()
                                });
                                if (statusEl) {
                                    statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
                                    statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                                    statusEl.style.color = '#6ee7b7';
                                    statusEl.textContent = 'Older device revoked. This machine is now registered.';
                                }
                                await loadDeviceManagementSection(true);
                                return;
                            } catch (confirmError) {
                                console.error('Nitra: Failed to replace device', confirmError);
                                if (statusEl) {
                                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                                    statusEl.style.color = '#fca5a5';
                                    statusEl.textContent = confirmError?.response?.error || confirmError?.message || 'Device replacement failed.';
                                }
                            }
                        } else if (statusEl) {
                            statusEl.style.background = 'rgba(251, 191, 36, 0.15)';
                            statusEl.style.border = '1px solid rgba(251, 191, 36, 0.35)';
                            statusEl.style.color = '#fcd34d';
                            statusEl.textContent = 'Registration cancelled.';
                        }
                    } else if (statusEl) {
                        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        statusEl.style.color = '#fca5a5';
                        statusEl.textContent = error?.response?.error || error?.message || 'Device registration failed.';
                    }
                }
            });
        }
    }
    
    const licenseStatus = formatLicenseStatus(state.currentLicenseStatus);
    const licenseStatusBaseStyle = [
        'margin: 12px 0',
        'font-size: 0.9em',
        'padding: 8px 12px',
        'border-radius: 6px',
        'background: #121212',
        'border: 1px solid #ffffff',
        'color: #ffffff',
        'display: inline-flex',
        'align-items: center',
        'gap: 8px',
        'width: fit-content',
        'max-width: 100%',
        'flex-wrap: wrap'
    ].join('; ');
    
    const logoPath = 'extensions/ComfyUI-Nitra/images/NitraLogo.png';
    const resolvedSidebarLogo = window?.app?.ui?.getFileUrl
        ? window.app.ui.getFileUrl(logoPath) || logoPath
        : logoPath;
    
    function createPanelCloseRow() {
        const row = document.createElement('div');
        row.className = 'nitra-panel-close-row';
        row.style.cssText = `
            width: calc(100% + 72px);
            margin: -36px -36px 16px -36px;
            padding: 16px 8px 0 16px;
            background: #000000;
            box-sizing: border-box;
            display: flex;
            justify-content: flex-end;
        `;
        const button = createCloseButton({ title: 'Close panel' });
        row.appendChild(button);
        return row;
    }

    updatePanel.innerHTML = `
        <div class="app-container" style="
            display: flex;
            flex-direction: row;
            height: 100%;
            width: 100%;
            overflow: hidden;
        ">
            <aside class="sidebar" style="
                display: flex;
                flex-direction: column;
                width: 260px;
                min-width: 260px;
                max-width: 260px;
                background: #0b0b0b;
                border-right: 1px solid #ffffff;
                overflow-y: auto;
            ">
                <!-- User Info Section -->
                <div style="
                    padding: 24px; 
                    border-bottom: 1px solid #ffffff;
                    background: transparent;
                ">
                    <div style="display: flex; justify-content: flex-start; align-items: center; margin-bottom: 16px;">
                        <a href="https://hi.nitralabs.ai" target="_blank" rel="noopener noreferrer" style="display:block; width:100%; border-radius:12px; border:1px solid #ffffff;">
                            <img src="${resolvedSidebarLogo}" alt="Nitra logo" style="width: 100%; border-radius: 12px; display:block;">
                        </a>
                    </div>
                    <div style="margin-bottom: 12px; width: 100%;">
                        <h2 style="color: #ffffff; margin: 0 0 6px 0; font-size: 1.3em; font-weight: 600;">Welcome back!</h2>
                        <p style="color: #bdbdbd; margin: 0; font-size: 1em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${state.currentUser.name || state.currentUser.username || 'User'}</p>
                    </div>
                    <div id="nitra-license-status" data-base-style="${licenseStatusBaseStyle}" style="${licenseStatusBaseStyle}; ${licenseStatus.style}">
                    ${licenseStatus.message}
                </div>
                <div id="nitra-device-warning" style="
                    display: none;
                    color: #f87171;
                    font-weight: 600;
                    margin-top: 6px;
                    font-size: 0.9em;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                "></div>
                <div id="nitra-device-warning-subtext" style="
                    display: none;
                    color: #fca5a5;
                    font-size: 0.85em;
                    margin-top: 4px;
                ">Register in User Configuration</div>
                    ${!state.currentLicenseStatus ? '<div id="nitra-license-loading" style="font-size: 0.8em; color: #bdbdbd; margin-top: 4px;">Fetching from server...</div>' : ''}
                <div id="nitra-purchase-link" style="margin: 8px 0; ${licenseStatus.showPurchaseLink ? 'display: block;' : 'display: none;'}">
                    <a href="${getWebsiteBaseUrl()}/#pricing" target="_blank" style="
                        color: #000000;
                        text-decoration: none;
                        font-weight: 600;
                        font-size: 0.9em;
                        border: 2px solid #000000;
                        padding: 8px 18px;
                        border-radius: 10px;
                            display: inline-flex;
                            align-items: center;
                        background: #ffffff;
                        transition: transform 0.2s ease, box-shadow 0.2s ease;
                        box-shadow: 0 0 18px rgba(255,255,255,0.45), 0 0 36px rgba(255,255,255,0.3);
                    " onmouseover="
                        this.style.transform='translateY(-1px)';
                        this.style.boxShadow='0 0 24px rgba(255,255,255,0.65), 0 0 50px rgba(255,255,255,0.4)';
                    " onmouseout="
                        this.style.transform='translateY(0)';
                        this.style.boxShadow='0 0 18px rgba(255,255,255,0.45), 0 0 36px rgba(255,255,255,0.3)';
                    ">
                        Purchase License
                    </a>
                </div>
            </div>
            
                <!-- Tab Navigation -->
                <nav class="p-tabview-nav" style="flex: 1; display: flex; flex-direction: column;">
                    <button id="nitra-tab-optimizer" class="nitra-tab nitra-tab-active" role="tab" aria-selected="true" aria-controls="nitra-optimizer-content">ComfyUI Optimizer</button>
                    <button id="nitra-tab-workflows" class="nitra-tab" role="tab" aria-selected="false" aria-controls="nitra-workflows-content">Workflows</button>
                    <button id="nitra-tab-models" class="nitra-tab" role="tab" aria-selected="false" aria-controls="nitra-models-content">Models</button>
                    <button id="nitra-tab-install-missing" class="nitra-tab" role="tab" disabled style="opacity: 0.5; cursor: not-allowed;">Install Missing (coming soon!)</button>
                    <button id="nitra-tab-user-config" class="nitra-tab" role="tab" aria-selected="false" aria-controls="nitra-user-config-content">User Configuration</button>
                    <button id="nitra-tab-help" class="nitra-tab" role="tab" aria-selected="false" aria-controls="nitra-help-content">How can we help?</button>
                    <button id="nitra-logout-btn" class="nitra-tab" role="tab">Logout</button>
                </nav>
            </aside>
            
            <!-- Tab Panels directly in app-container -->
            <div class="p-tabpanels settings-tab-panels" role="presentation" data-pc-name="tabpanels" style="flex: 1; display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #0b0b0b;">
                    <!-- ComfyUI Optimizer Tab Panel -->
                    <div class="p-tabpanel p-tabpanel-active optimizer-panel" id="nitra-optimizer-content" tabindex="0" role="tabpanel" aria-labelledby="nitra-tab-optimizer" data-pc-name="tabpanel" data-p-active="true" style="flex: 1; display: flex; flex-direction: column; height: 100%; overflow: auto; padding: 36px; justify-content: flex-start; align-items: stretch;">
                        <h3 class="nitra-section-header" style="margin-top: 0; margin-bottom: 16px;">ComfyUI Optimizer</h3>
                        <!-- Dynamic Comfy Config Buttons Container -->
                        <div id="nitra-comfy-configs-container" style="
                            width: 100%;
                            margin-bottom: 12px;
                        ">
                            <!-- Dynamic buttons will be loaded here -->
                        </div>
                        
                        <!-- ComfyUI Utilities Section -->
                        <div style="margin-top: 24px;">
                            <h4 style="
                                margin: 0 0 12px 0;
                                color: #ffffff;
                                font-size: 1.1em;
                                font-weight: 600;
                                letter-spacing: 0.05em;
                                text-transform: uppercase;
                            ">ComfyUI Utilities</h4>
                            <div style="
                                display: grid;
                                grid-template-columns: repeat(2, minmax(0, 1fr));
                                gap: 12px;
                                align-items: stretch;
                            ">
                            <!-- Update Nitra Button -->
                                <button id="nitra-optimizer-update-nitra-btn" class="nitra-btn nitra-btn-primary nitra-btn-full-width" style="
                                padding: 16px 20px;
                                font-size: 1.1em;
                                    height: 100%;
                            ">
                                Update Nitra
                            </button>
                            
                            <!-- Update ComfyUI Button -->
                                <button id="nitra-optimizer-update-btn" class="nitra-btn nitra-btn-primary nitra-btn-full-width" style="
                                padding: 16px 20px;
                                font-size: 1.1em;
                                    height: 100%;
                            ">
                                Update ComfyUI
                            </button>
                            
                            <!-- Restart Button -->
                                <button id="nitra-optimizer-restart-btn" class="nitra-btn nitra-btn-primary nitra-btn-full-width" style="
                                padding: 16px 20px;
                                font-size: 1.1em;
                                    height: 100%;
                            ">
                                Restart ComfyUI
                            </button>
                        
                        <!-- Refresh Button -->
                                <button id="nitra-optimizer-refresh-btn" class="nitra-btn nitra-btn-primary nitra-btn-full-width" style="
                            padding: 16px 20px;
                            font-size: 1.1em;
                                    height: 100%;
                        ">
 Refresh Page
                        </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Workflows Tab Panel -->
                    <div class="p-tabpanel workflows-panel" id="nitra-workflows-content" tabindex="0" role="tabpanel" aria-labelledby="nitra-tab-workflows" data-pc-name="tabpanel" data-p-active="false" style="flex: 1; display: none; flex-direction: column; height: 100%; overflow: hidden; padding: 36px;">
                        <!-- Search & Category Filter -->
                        <div style="margin-bottom: 16px; display: flex; gap: 12px; flex-wrap: wrap;">
                            <input type="text" id="nitra-workflow-search" class="nitra-input" placeholder=" Search workflows by name, description, or tag..." style="
                                padding: 12px 16px;
                                flex: 1;
                                min-width: 220px;
                                background: #000000;
                                color: #ffffff;
                                border: 1px solid #ffffff;
                                border-radius: 10px;
                                font-family: var(--comfy-font-family);
                                font-size: 14px;
                            ">
                            <select id="nitra-workflow-category-filter" style="
                                min-width: 180px;
                                padding: 12px 14px;
                                border-radius: 10px;
                                border: 1px solid #ffffff;
                                background: #000000;
                                color: #ffffff;
                                font-size: 0.9em;
                            ">
                                <option value="all">All Categories</option>
                            </select>
                        </div>

                        <!-- Upgrade banner placeholder (controlled by workflows/ui.js) -->
                        <div id="nitra-workflows-upgrade"></div>
                        
                        <!-- Deselect All Button -->
                        <div style="margin-bottom: 8px; display: flex; justify-content: flex-end; gap: 8px;">
                            <button id="nitra-select-all-workflows" style="
                                padding: 6px 12px;
                                background: transparent;
                                border: 1px solid #ffffff;
                                border-radius: 4px;
                                color: #ffffff;
                                font-size: 11px;
                                font-weight: 500;
                                cursor: pointer;
                                transition: all 0.2s ease;
                                opacity: 0.8;
                            " onmouseover="
                                this.style.opacity='1';
                                this.style.background='rgba(255,255,255,0.1)';
                                this.style.borderColor='#ffffff';
                            " onmouseout="
                                this.style.opacity='0.8';
                                this.style.background='transparent';
                                this.style.borderColor='#ffffff';
                            ">
                                ✓ Select All
                            </button>
                            <button id="nitra-deselect-all-workflows" style="
                                padding: 6px 12px;
                                background: transparent;
                                border: 1px solid #ffffff;
                                border-radius: 4px;
                                color: #ffffff;
                                font-size: 11px;
                                font-weight: 500;
                                cursor: pointer;
                                transition: all 0.2s ease;
                                opacity: 0.8;
                            " onmouseover="
                                this.style.opacity='1';
                                this.style.background='rgba(255,255,255,0.1)';
                                this.style.borderColor='#ffffff';
                            " onmouseout="
                                this.style.opacity='0.8';
                                this.style.background='transparent';
                                this.style.borderColor='#ffffff';
                            ">
                                ✕ Deselect All
                            </button>
                        </div>
                        
                        <!-- Workflows List Container -->
                        <div id="nitra-workflows-list" style="
                            flex: 1;
                            overflow-y: auto;
                            border: 1px solid var(--comfy-input-border);
                            border-radius: 12px;
                            padding: 8px;
                            background: #1a1a1a;
                            min-height: 0;
                        ">
                            <div style="text-align: center; padding: 20px; color: var(--comfy-input-text);">
                                Loading workflows...
                            </div>
                        </div>
                            
                        <!-- Bottom Section (HF Token + Install Button) -->
                        <div id="nitra-workflows-bottom-section" style="flex-shrink: 0; padding: 12px 0; margin-top: 12px;">
                            <!-- HuggingFace Token Input -->
                            <div id="nitra-workflow-hf-token-container" style="display: none; margin-bottom: 12px;">
                                <div id="nitra-workflow-install-message" style="display:none; margin-bottom:8px;"></div>
                                <label style="display: block; margin-bottom: 8px; color: var(--comfy-input-text); font-weight: bold;">
                                    <span id="nitra-workflow-hf-token-prefix">Optional:</span> HuggingFace Token
                                </label>
                                <div style="position: relative;">
                                    <input type="password" id="nitra-workflow-hf-token" placeholder="Enter your HuggingFace token" style="
                                        width: 100%;
                                        padding: 8px 50px 8px 8px;
                                        border: 1px solid #ffffff;
                                        border-radius: 4px;
                                        background: #121212;
                                        color: #ffffff;
                                        font-size: 0.9em;
                                    ">
                                    <button id="nitra-workflow-hf-token-toggle" type="button" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: #f5f5f5; cursor: pointer; padding: 6px 8px; font-size: 13px; font-weight: 500; line-height: 1; transition: opacity 0.2s; user-select: none; opacity: 0.7;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Show password">Show</button>
                                </div>
                                <div id="nitra-workflow-hf-token-help" style="font-size: 0.8em; color: var(--comfy-input-text); opacity: 0.7; margin-top: 4px;">
                                    Enter your HuggingFace token for faster downloads and access to private models. <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:#ffffff; text-decoration:underline;">Click here to create token</a>
                                </div>
                            </div>
                            
                            <!-- Install Button -->
                            <button id="nitra-install-workflows-btn" class="p-button" style="
                                width: 100%;
                                padding: 12px;
                                background: #0b0b0b;
                                color: #ffffff;
                                border: 1px solid #ffffff;
                                border-radius: 4px;
                                cursor: pointer;
                                font-weight: bold;
                                font-size: 1.1em;
                            ">Install Selected Workflows</button>
                        </div>
                    </div>
                    
                    <!-- Models Tab Panel -->
                    <div class="p-tabpanel models-panel" id="nitra-models-content" tabindex="0" role="tabpanel" aria-labelledby="nitra-tab-models" data-pc-name="tabpanel" data-p-active="false" style="flex: 1; display: none; flex-direction: column; height: 100%; overflow: hidden; padding: 36px;">
                        <!-- Search + Install Folder Filter -->
                        <div style="margin-bottom: 20px; display: flex; gap: 12px; flex-wrap: wrap;">
                            <input type="text" id="nitra-model-search" class="nitra-input" placeholder=" Search models by name, description, or tag..." style="
                                flex: 1;
                                min-width: 220px;
                                padding: 12px 16px;
                                border: 1px solid #ffffff;
                                border-radius: 10px;
                                background: #000000;
                                color: #ffffff;
                                font-family: var(--comfy-font-family);
                                font-size: 14px;
                                box-sizing: border-box;
                                transition: border-color 0.3s ease, box-shadow 0.3s ease;
                            " onfocus="
                                this.style.borderColor='#ffffff';
                                this.style.boxShadow='0 0 0 2px rgba(255, 255, 255, 0.12)';
                            " onblur="
                                this.style.borderColor='#ffffff';
                                this.style.boxShadow='none';
                            ">
                            <select id="nitra-model-folder-filter" class="nitra-input" style="
                                width: 220px;
                                padding: 12px 16px;
                                border: 1px solid #ffffff;
                                border-radius: 10px;
                                background: #000000;
                                color: #ffffff;
                                font-family: var(--comfy-font-family);
                                font-size: 14px;
                                box-sizing: border-box;
                                transition: border-color 0.3s ease, box-shadow 0.3s ease;
                            " onfocus="
                                this.style.borderColor='#ffffff';
                                this.style.boxShadow='0 0 0 2px rgba(255, 255, 255, 0.12)';
                            " onblur="
                                this.style.borderColor='#ffffff';
                                this.style.boxShadow='none';
                            ">
                                <option value="">All Model Types</option>
                            </select>
                        </div>
                        
                        <!-- Deselect All Button -->
                        <div style="margin-bottom: 8px; display: flex; justify-content: flex-end; gap: 8px;">
                            <button id="nitra-select-all-models" style="
                                padding: 6px 12px;
                                background: transparent;
                                border: 1px solid #ffffff;
                                border-radius: 4px;
                                color: #ffffff;
                                font-size: 11px;
                                font-weight: 500;
                                cursor: pointer;
                                transition: all 0.2s ease;
                                opacity: 0.8;
                            " onmouseover="
                                this.style.opacity='1';
                                this.style.background='rgba(255,255,255,0.1)';
                                this.style.borderColor='#ffffff';
                            " onmouseout="
                                this.style.opacity='0.8';
                                this.style.background='transparent';
                                this.style.borderColor='#ffffff';
                            ">
                                ✓ Select All
                            </button>
                            <button id="nitra-deselect-all-models" style="
                                padding: 6px 12px;
                                background: transparent;
                                border: 1px solid #ffffff;
                                border-radius: 4px;
                                color: #ffffff;
                                font-size: 11px;
                                font-weight: 500;
                                cursor: pointer;
                                transition: all 0.2s ease;
                                opacity: 0.8;
                            " onmouseover="
                                this.style.opacity='1';
                                this.style.background='rgba(255,255,255,0.1)';
                                this.style.borderColor='#ffffff';
                            " onmouseout="
                                this.style.opacity='0.8';
                                this.style.background='transparent';
                                this.style.borderColor='#ffffff';
                            ">
                                ✕ Deselect All
                            </button>
                        </div>
                        
                        <!-- Models List Container -->
                        <div id="nitra-models-list" style="
                            flex: 1;
                            overflow-y: auto;
                            border: 1px solid var(--comfy-input-border);
                            border-radius: 12px;
                            padding: 8px;
                            background: #1a1a1a;
                            min-height: 0;
                        ">
                            <div style="text-align: center; padding: 20px; color: var(--comfy-input-text);">
                                Loading models...
                            </div>
                        </div>
                        
                        <!-- Bottom Section (HF Token + Download Button) -->
                        <div id="nitra-models-bottom-section" style="flex-shrink: 0; padding: 12px 0; margin-top: 12px;">
                            <!-- HuggingFace Token Input -->
                            <div id="nitra-hf-token-container" style="display: none; margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 8px; color: var(--comfy-input-text); font-weight: bold;">
                                    <span id="nitra-hf-token-prefix" style="color: #ffffff; font-weight: bold;">Optional:</span> HuggingFace Token
                                </label>
                                <div style="position: relative;">
                                    <input type="password" id="nitra-hf-token" placeholder="Enter your HuggingFace token" style="
                                        width: 100%;
                                        padding: 8px 50px 8px 8px;
                                        border: 1px solid #ffffff;
                                        border-radius: 4px;
                                        background: #121212;
                                        color: #ffffff;
                                        font-size: 0.9em;
                                    ">
                                    <button id="nitra-hf-token-toggle" type="button" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: #f5f5f5; cursor: pointer; padding: 6px 8px; font-size: 13px; font-weight: 500; line-height: 1; transition: opacity 0.2s; user-select: none; opacity: 0.7;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Show password">Show</button>
                                </div>
                                <div id="nitra-hf-token-help" style="font-size: 0.8em; color: var(--comfy-input-text); opacity: 0.7; margin-top: 4px;">
                                    Enter your HuggingFace token for faster downloads and access to private models. <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:#ffffff; text-decoration:underline;">Click here to create token</a>
                                </div>
                            </div>
                            
                            <!-- Download Button -->
                            <button id="nitra-download-models-btn" class="p-button" style="
                                width: 100%;
                                padding: 12px;
                                background: #0b0b0b;
                                color: #ffffff;
                                border: 1px solid #ffffff;
                                border-radius: 4px;
                                cursor: pointer;
                                font-weight: bold;
                                font-size: 1.1em;
                            ">Download Selected Models</button>
                        </div>
                    </div>

                    <!-- User Configuration Tab Panel -->
                    <div class="p-tabpanel user-config-panel" id="nitra-user-config-content" tabindex="0" role="tabpanel" aria-labelledby="nitra-tab-user-config" data-pc-name="tabpanel" data-p-active="false" style="flex: 1; display: none; flex-direction: column; height: 100%; overflow: auto; padding: 36px;">
                        <div class="nitra-modern-card" style="padding: 24px; width: 100%; box-sizing: border-box;">
                            <div style="display:grid; gap:16px;">
                                <div>
                                    <label for=\"nitra-extra-model-paths\" style=\"display:block; margin-bottom:6px; color:#ffffff; font-weight:600;\">Extra Model Path</label>
                                    <textarea id=\"nitra-extra-model-paths\" rows=\"2\" placeholder=\"Enter a single model path (e.g. D:\\\\Models\\\\ or /mnt/models)\" style=\"width:100%; padding:10px 12px; border:1px solid #ffffff; border-radius:8px; background:#121212; color:#ffffff; resize: vertical;\"></textarea>
                                    <div style=\"color: #bdbdbd; font-size:12px; margin-top:6px;\">Enter an absolute path to a folder containing models. This will be added to ComfyUI's model search locations via extra_model_paths.yaml</div>
                                </div>

                                <div>
                                    <label for=\"nitra-config-hf-token\" style=\"display:block; margin-bottom:6px; color:#ffffff; font-weight:600;\">Huggingface Token (Stored Locally Only)</label>
                                    <div style=\"position:relative;\">
                                        <input id=\"nitra-config-hf-token\" type=\"password\" placeholder=\"hf_...\" style=\"width:100%; padding:10px 55px 10px 12px; border:1px solid #ffffff; border-radius:8px; background:#121212; color:#ffffff;\">
                                        <button id=\"nitra-config-hf-token-toggle\" type=\"button\" style=\"position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:#f5f5f5; cursor:pointer; padding:6px 8px; font-size:13px; font-weight:500; line-height:1; transition:opacity 0.2s; user-select:none; opacity:0.7;\" onmouseover=\"this.style.opacity='1'\" onmouseout=\"this.style.opacity='0.7'\" title=\"Show password\">Show</button>
                                    </div>
                                    <div style=\"color:#bdbdbd; font-size:0.85em; margin-top:4px;\">Don't have one? <a href=\"https://huggingface.co/settings/tokens\" target=\"_blank\" style=\"color:#ffffff; text-decoration:underline;\">Click here to create a HuggingFace token</a>.</div>
                                </div>

                                <div style="display:flex; gap:12px;">
                                    <button id=\"nitra-save-user-config\" class=\"nitra-modern-button\" style=\"padding:10px 16px; border-radius:8px; font-weight:700; background:#0b0b0b; color:#ffffff; border:1px solid #ffffff;\">Save Settings</button>
                                    <button id=\"nitra-reload-user-config\" class=\"nitra-accent-button\" style=\"padding:10px 16px; border-radius:8px; font-weight:700; background:#ffffff; color:#0b0b0b; border:1px solid #0b0b0b;\">Reload</button>
                                </div>

                                <div id="nitra-user-config-status" style="display:none; margin-top:4px; padding:10px; border-radius:8px; font-weight:600;"></div>

                                <div id="nitra-device-management" class="nitra-modern-card" style="padding:24px; display:none; margin-top:16px;">
                                    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
                                        <div>
                                            <h4 style="color:#FFFFFF; margin:0 0 8px 0; font-size:1.05em;">Registered Machines</h4>
                                            <p style="color:#bdbdbd; margin:0 0 8px 0; font-size:0.85em;">Allowing access to multiple users under one account is against the Terms &amp; Conditions of ComfyUI-Nitra and may result in your account being banned.</p>
                                            <p id="nitra-device-slots" style="color:#d1d5db; margin:0; font-size:0.8em;">Machine slots used: --/2</p>
                                        </div>
                                        <button id="nitra-refresh-device-btn" class="nitra-modern-button" style="padding:8px 12px; border-radius:8px; font-weight:600; background:#ffffff; color:#0b0b0b; border:1px solid #0b0b0b;">Refresh</button>
                                    </div>
                                    <div id="nitra-device-identity" style="margin-top:12px;"></div>
                                    <div id="nitra-device-list" style="margin-top:12px; display:flex; flex-direction:column; gap:12px;"></div>
                                    <div style="margin-top:16px;">
                                        <label for="nitra-device-label-input" style="display:block; margin-bottom:6px; color:#ffffff; font-weight:600;">Device Name</label>
                                        <input id="nitra-device-label-input" type="text" placeholder="Workstation name" style="width:100%; padding:10px 12px; border:1px solid #ffffff; border-radius:8px; background:#121212; color:#ffffff;">
                                    </div>
                                    <button id="nitra-register-device-btn" class="nitra-modern-button" style="margin-top:12px; padding:10px 16px; border-radius:8px; font-weight:700; background:#D14E72; color:#ffffff; border:1px solid #D14E72;">Register / Replace Device</button>
                                    <div id="nitra-device-status" style="display:none; margin-top:12px; padding:10px; border-radius:8px; font-weight:600;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- How can we help? Tab Panel -->
                    <div class="p-tabpanel help-panel" id="nitra-help-content" tabindex="0" role="tabpanel" aria-labelledby="nitra-tab-help" data-pc-name="tabpanel" data-p-active="false" style="flex: 1; display: none; flex-direction: column; height: 100%; overflow: auto; padding: 36px;">
                        <div style="margin-bottom: 24px;">
                            <p style="margin: 0 0 12px 0; color: rgba(160, 187, 196, 0.8); font-size: 13px;">Have a suggestion or found a bug? Submit it as a GitHub issue. This form is for business inquiries only.</p>
                            <a href="https://github.com/TheArtOfficial/ComfyUI-Nitra/issues" target="_blank" rel="noopener noreferrer" style="
                                display: inline-flex;
                                align-items: center;
                                gap: 8px;
                                padding: 12px 20px;
                                background: #24292e;
                                color: #FFFFFF;
                                border: 1px solid rgba(160, 187, 196, 0.3);
                                border-radius: 8px;
                                text-decoration: none;
                                font-weight: 600;
                                font-size: 14px;
                                transition: all 0.3s ease;
                                box-shadow: 0 2px 8px rgba(36, 41, 46, 0.3);
                            " onmouseover="
                                this.style.transform='translateY(-2px)';
                                this.style.boxShadow='0 4px 12px rgba(36, 41, 46, 0.4)';
                                this.style.background='#2f363d';
                            " onmouseout="
                                this.style.transform='translateY(0)';
                                this.style.boxShadow='0 2px 8px rgba(36, 41, 46, 0.3)';
                                this.style.background='#24292e';
                            ">
                                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="vertical-align: middle;">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                                </svg>
                                Report Issue on GitHub
                            </a>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr; gap: 24px; width: 100%; max-width: 1000px;">
                            <div class="nitra-modern-card" style="padding: 24px;">
                                <h4 style="color: #F0F0F0; margin: 0 0 16px 0; font-size: 1.2em; font-weight: 600;">Why work with us?</h4>
                                <ul style="color: rgba(160, 187, 196, 0.9); margin:0; padding-left:18px; line-height:1.7;">
                                    <li>Proven track record in VFX and film industry</li>
                                    <li>Custom AI solutions for your specific pipeline</li>
                                    <li>Secure, enterprise-grade implementations</li>
                                    <li>Dramatic efficiency gains and cost reduction</li>
                                </ul>
                            </div>
                            
                            <div class="nitra-modern-card" style="padding: 24px;">
                                <h4 style="color: #F0F0F0; margin: 0 0 16px 0; font-size: 1.2em; font-weight: 600;">Send us a message</h4>
                                <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                                    <div>
                                        <label style="display:block; margin-bottom:6px; color: rgba(160, 187, 196, 0.9); font-size: 0.95em;">Name *</label>
                                        <input type="text" id="nitra-help-name" placeholder="Your full name" class="nitra-help-input">
                                    </div>
                                    <div>
                                        <label style="display:block; margin-bottom:6px; color: rgba(160, 187, 196, 0.9); font-size: 0.95em;">Email *</label>
                                        <input type="email" id="nitra-help-email" placeholder="your.email@company.com" class="nitra-help-input">
                                    </div>
                                    <div>
                                        <label style="display:block; margin-bottom:6px; color: rgba(160, 187, 196, 0.9); font-size: 0.95em;">Phone</label>
                                        <div style="display:flex; gap:8px;">
                                            <select id="nitra-help-country" class="nitra-help-input" style="max-width:120px;">
                                                <option value="+1">🇺🇸  +1</option>
                                                <option value="+44">🇬🇧  +44</option>
                                                <option value="+33">🇫🇷  +33</option>
                                                <option value="+43">🇦🇹  +43</option>
                                                <option value="+61">🇦🇺  +61</option>
                                                <option value="+32">🇧🇪  +32</option>
                                                <option value="+55">🇧🇷  +55</option>
                                                <option value="+41">🇨🇭  +41</option>
                                                <option value="+86">🇨🇳  +86</option>
                                                <option value="+57">🇨🇴  +57</option>
                                                <option value="+45">🇩🇰  +45</option>
                                                <option value="+49">🇩🇪  +49</option>
                                                <option value="+20">🇪🇬  +20</option>
                                                <option value="+34">🇪🇸  +34</option>
                                                <option value="+39">🇮🇹  +39</option>
                                                <option value="+81">🇯🇵  +81</option>
                                                <option value="+82">🇰🇷  +82</option>
                                                <option value="+31">🇳🇱  +31</option>
                                                <option value="+64">🇳🇿  +64</option>
                                                <option value="+47">🇳🇴  +47</option>
                                                <option value="+48">🇵🇱  +48</option>
                                                <option value="+351">🇵🇹 +351</option>
                                                <option value="+51">🇵🇪  +51</option>
                                                <option value="+30">🇬🇷  +30</option>
                                                <option value="+27">🇿🇦  +27</option>
                                                <option value="+46">🇸🇪  +46</option>
                                                <option value="+52">🇲🇽  +52</option>
                                                <option value="+54">🇦🇷  +54</option>
                                                <option value="+56">🇨🇱  +56</option>
                                                <option value="+58">🇻🇪  +58</option>
                                            </select>
                                            <input type="tel" id="nitra-help-phone" placeholder="(555) 123-4567" class="nitra-help-input" style="flex:1;">
                                        </div>
                                    </div>
                                    <div>
                                        <label style="display:block; margin-bottom:6px; color: rgba(160, 187, 196, 0.9); font-size: 0.95em;">Company</label>
                                        <input type="text" id="nitra-help-company" placeholder="Your company name" class="nitra-help-input">
                                    </div>
                                    <div>
                                        <label style="display:block; margin-bottom:6px; color: rgba(160, 187, 196, 0.9); font-size: 0.95em;">Message *</label>
                                        <textarea id="nitra-help-message" rows="5" placeholder="Tell us about your project and how we can help..." class="nitra-help-input" style="resize: vertical;"></textarea>
                                    </div>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <input id="nitra-help-newsletter" type="checkbox" style="width:16px; height:16px;">
                                        <label for="nitra-help-newsletter" style="color: rgba(160, 187, 196, 0.9); font-size: 0.95em;">I'd like to receive emails with the latest news and products from Nitra</label>
                                    </div>
                                    <div>
                                        <button id="nitra-help-submit" class="nitra-modern-button" style="width:100%; padding:12px 16px; border-radius:10px; font-weight:700; background:#0b0b0b; color:#ffffff; border:1px solid #ffffff;">Send Message</button>
                                    </div>
                                    <div id="nitra-help-status" style="display:none; margin-top:8px; padding:10px; border-radius:8px; font-weight:600;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
            
            <div id="nitra-update-status" style="
                padding: 12px;
                border-radius: 4px;
                text-align: center;
                display: none;
            "></div>
        </div>
    `;

    const panelIds = [
        'nitra-optimizer-content',
        'nitra-workflows-content',
        'nitra-models-content',
        'nitra-user-config-content',
        'nitra-help-content'
    ];

    panelIds.forEach(id => {
        const panel = updatePanel.querySelector(`#${id}`);
        if (panel && !panel.querySelector('.nitra-panel-close-row')) {
            panel.insertBefore(createPanelCloseRow(), panel.firstChild);
        }
    });

    setupDeviceManagementEvents();
    
    // Old checkbox event listeners removed - now using modern optimizer buttons
    
    // Tab switching functionality
    const tabButtons = updatePanel.querySelectorAll('.nitra-tab:not(#nitra-logout-btn)');
    const tabContents = updatePanel.querySelectorAll('.p-tabpanel');

    function showTab(tabId) {
        const tabExists = tabId && updatePanel.querySelector(`#nitra-tab-${tabId}`);
        const normalizedTab = tabExists ? tabId : (lastActiveTab && updatePanel.querySelector(`#nitra-tab-${lastActiveTab}`) ? lastActiveTab : 'optimizer');
        lastActiveTab = normalizedTab;

        tabButtons.forEach(btn => {
            const isActive = btn.id === `nitra-tab-${normalizedTab}`;
            btn.classList.toggle('nitra-tab-active', isActive);
        });

        tabContents.forEach(content => {
            const isActive = content.id === `nitra-${normalizedTab}-content`;
            content.classList.toggle('p-tabpanel-active', isActive);
            content.setAttribute('data-p-active', isActive ? 'true' : 'false');
            content.style.display = isActive ? 'flex' : 'none';
        });

        if (normalizedTab === 'workflows') {
            if (typeof renderWorkflows === 'function') {
                renderWorkflows();
            }
            if (typeof loadWorkflows === 'function') {
                loadWorkflows({ backgroundRefresh: true }).then(success => {
                    if (success && typeof renderWorkflows === 'function') {
                        renderWorkflows();
                    }
                });
            }
        } else if (normalizedTab === 'models') {
            if (typeof renderModels === 'function') {
                renderModels();
            }
            if (typeof loadModels === 'function') {
                loadModels({ backgroundRefresh: true }).then(success => {
                    if (success && typeof renderModels === 'function') {
                        renderModels();
                    }
                });
            }
        } else if (normalizedTab === 'user-config') {
            setupPasswordToggle();
            const statusEl = updatePanel.querySelector('#nitra-user-config-status');
            if (statusEl) statusEl.style.display = 'none';
            fetch('/nitra/user-config', { method: 'GET' })
                .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load')))
                .then(cfg => {
                    const pathsEl = document.getElementById('nitra-extra-model-paths');
                    const tokenEl = document.getElementById('nitra-config-hf-token');
                    if (pathsEl) {
                        if (cfg.extra_model_paths && Array.isArray(cfg.extra_model_paths)) {
                            pathsEl.value = cfg.extra_model_paths.join('\n');
                        } else {
                            pathsEl.value = '';
                        }
                    }
                    if (tokenEl) {
                        if (cfg.huggingface_token && typeof cfg.huggingface_token === 'string') {
                            tokenEl.value = cfg.huggingface_token;
                        } else {
                            tokenEl.value = '';
                        }
                        tokenEl.type = 'password';
                    }
                    const toggleBtn = document.getElementById('nitra-config-hf-token-toggle');
                    if (toggleBtn) {
                        toggleBtn.textContent = 'Show';
                        toggleBtn.title = 'Show password';
                    }
                })
                .catch(() => {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        statusEl.style.color = '#fca5a5';
                        statusEl.textContent = 'Failed to load user configuration.';
                    }
                });

            if (state.currentUser?.apiToken) {
                loadDeviceManagementSection(!deviceSectionInitialized);
            }
        }
    }
    
    // Update list heights after interface is created
    setTimeout(() => {
        updateListHeights();
    }, 100);
    
    // Add window resize listener for dynamic height updates
    window.addEventListener('resize', updateListHeights);
    
    tabButtons.forEach(button => {
        button.onclick = () => {
            const tabId = button.id.replace('nitra-tab-', '');
            showTab(tabId);
        };
    });
    
    // Initialize tab display with last selected tab when available.
    // Defer until the panel is attached so cached content (e.g., workflows) can render immediately.
    const initiateTabDisplay = () => showTab(lastActiveTab);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(initiateTabDisplay);
    } else {
        setTimeout(initiateTabDisplay, 0);
    }
    
    // Logout button click handler
    const logoutBtn = updatePanel.querySelector('#nitra-logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = async (event) => {
            // Show confirmation dialog
            const confirmed = confirm("Are you sure you want to log out?");
            
            if (!confirmed) {
                return; // User cancelled, do nothing
            }
            
            const button = event.target;
            const originalText = button.textContent;
            
            try {
                button.textContent = "Logging out...";
                button.disabled = true;
                button.style.opacity = "0.6";
                
                await logoutWebsite();

                button.textContent = originalText;
                button.disabled = false;
                button.style.opacity = "1";

                if (typeof state.openNitraDialog === 'function') {
                    state.openNitraDialog();
                } else {
                    updateDialogForLogin();
                }
                
            } catch (error) {
                console.error("Nitra: Logout button error", error);
                
                button.textContent = originalText;
                button.disabled = false;
                button.style.opacity = "1";
                
                state.setAuthenticated(false);
                state.setCurrentUser(null);
                localStorage.clear();
                updateDialogForLogin();
                
                alert("Logout encountered an error. Local session has been cleared.");
            }
        };
    }
    
    // Help tab: submit to website contact API
    const helpSubmitBtn = updatePanel.querySelector('#nitra-help-submit');
    if (helpSubmitBtn) {
        helpSubmitBtn.addEventListener('mouseenter', () => {
            helpSubmitBtn.style.background = '#121212';
        });
        helpSubmitBtn.addEventListener('mouseleave', () => {
            helpSubmitBtn.style.background = '#0b0b0b';
        });
        helpSubmitBtn.onclick = async () => {
            const statusEl = updatePanel.querySelector('#nitra-help-status');
            const name = (updatePanel.querySelector('#nitra-help-name') || {}).value || '';
            const email = (updatePanel.querySelector('#nitra-help-email') || {}).value || '';
            const phone = (updatePanel.querySelector('#nitra-help-phone') || {}).value || '';
            const countryCode = (updatePanel.querySelector('#nitra-help-country') || {}).value || '+1';
            const company = (updatePanel.querySelector('#nitra-help-company') || {}).value || '';
            const message = (updatePanel.querySelector('#nitra-help-message') || {}).value || '';
            const newsletterOptIn = (updatePanel.querySelector('#nitra-help-newsletter') || {}).checked || false;

            // Basic validation (mirror website behavior)
            if (!name || !email || !message) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.textContent = 'Please fill in required fields: Name, Email, and Message.';
                }
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.textContent = 'Please enter a valid email address.';
                }
                return;
            }

            if (phone) {
                const cleanPhone = phone.replace(/\D/g, '');
                if (cleanPhone.length < 10 || cleanPhone.length > 15) {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        statusEl.style.color = '#fca5a5';
                        statusEl.textContent = 'Please enter a valid phone number.';
                    }
                    return;
                }
            }

            helpSubmitBtn.disabled = true;
            const originalText = helpSubmitBtn.textContent;
            helpSubmitBtn.textContent = 'Sending...';
            if (statusEl) statusEl.style.display = 'none';

            try {
                const response = await fetch('/nitra/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        email,
                        phone,
                        countryCode,
                        message,
                        subscribeToNewsletter: newsletterOptIn
                    })
                });

                if (response.ok) {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(34, 197, 94, 0.15)';
                        statusEl.style.border = '1px solid rgba(34, 197, 94, 0.4)';
                        statusEl.style.color = '#86efac';
                        statusEl.textContent = "Thank you! Your message has been sent successfully.";
                    }
                    // Clear form
                    const setVal = (sel, val) => { const el = updatePanel.querySelector(sel); if (el) el.value = val; };
                    setVal('#nitra-help-name', '');
                    setVal('#nitra-help-email', '');
                    setVal('#nitra-help-phone', '');
                    setVal('#nitra-help-country', '+1');
                    setVal('#nitra-help-company', '');
                    setVal('#nitra-help-message', '');
                    const newsletterEl = updatePanel.querySelector('#nitra-help-newsletter');
                    if (newsletterEl) newsletterEl.checked = false;
                } else {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        statusEl.style.color = '#fca5a5';
                        statusEl.textContent = 'Sorry, there was an error sending your message. Please try again.';
                    }
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.textContent = 'Network error. Please try again later.';
                }
            } finally {
                helpSubmitBtn.disabled = false;
                helpSubmitBtn.textContent = originalText;
            }
        };
    }

    // User config save/reload handlers
    const saveCfgBtn = updatePanel.querySelector('#nitra-save-user-config');
    const reloadCfgBtn = updatePanel.querySelector('#nitra-reload-user-config');
    if (saveCfgBtn) {
        saveCfgBtn.onclick = async () => {
            const statusEl = updatePanel.querySelector('#nitra-user-config-status');
            if (statusEl) statusEl.style.display = 'none';
            const pathsEl = document.getElementById('nitra-extra-model-paths');
            const tokenEl = document.getElementById('nitra-config-hf-token');
            if (!pathsEl || !tokenEl) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.textContent = 'Configuration fields not found.';
                }
                return;
            }
            const paths = pathsEl.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const token = tokenEl.value.trim();
            const payload = { extra_model_paths: paths, huggingface_token: token };
            const original = saveCfgBtn.textContent;
            saveCfgBtn.disabled = true;
            saveCfgBtn.textContent = 'Saving...';
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (state.currentUser?.apiToken) {
                    headers['Authorization'] = `Bearer ${state.currentUser.apiToken}`;
                }
                if (state.currentUser?.email) {
                    headers['X-User-Email'] = state.currentUser.email;
                }
                const resp = await fetch('/nitra/user-config', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
                if (resp.ok) {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(34, 197, 94, 0.15)';
                        statusEl.style.border = '1px solid rgba(34, 197, 94, 0.4)';
                        statusEl.style.color = '#86efac';
                        statusEl.textContent = 'Settings saved.';
                    }
                } else {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        statusEl.style.color = '#fca5a5';
                        statusEl.textContent = 'Failed to save settings.';
                    }
                }
            } catch (e) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.textContent = 'Network error saving settings.';
                }
            } finally {
                saveCfgBtn.disabled = false;
                saveCfgBtn.textContent = original;
            }
        };
    }
    if (reloadCfgBtn) {
        reloadCfgBtn.onclick = async () => {
            const statusEl = updatePanel.querySelector('#nitra-user-config-status');
            if (statusEl) statusEl.style.display = 'none';
            try {
                const r = await fetch('/nitra/user-config');
                if (!r.ok) throw new Error('failed');
                const cfg = await r.json();
                const pathsEl = document.getElementById('nitra-extra-model-paths');
                const tokenEl = document.getElementById('nitra-config-hf-token');
                if (pathsEl) {
                    if (cfg.extra_model_paths && Array.isArray(cfg.extra_model_paths)) {
                        pathsEl.value = cfg.extra_model_paths.join('\n');
                    } else {
                        pathsEl.value = '';
                    }
                }
                if (tokenEl) {
                    if (cfg.huggingface_token && typeof cfg.huggingface_token === 'string') {
                        tokenEl.value = cfg.huggingface_token;
                    } else {
                        tokenEl.value = '';
                    }
                    tokenEl.type = 'password';
                }
                const toggleBtn = document.getElementById('nitra-config-hf-token-toggle');
                if (toggleBtn) {
                    toggleBtn.textContent = 'Show';
                    toggleBtn.title = 'Show password';
                }
            } catch (e) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.textContent = 'Failed to reload user configuration.';
                }
            }
        };
    }
    
    // Password toggle handler setup function - call when tab is shown
    const setupPasswordToggle = () => {
        const hfConfigTokenToggleBtn = document.getElementById('nitra-config-hf-token-toggle');
        if (hfConfigTokenToggleBtn) {
            hfConfigTokenToggleBtn.onclick = () => {
                const tokenInput = document.getElementById('nitra-config-hf-token');
                if (tokenInput) {
                    if (tokenInput.type === 'password') {
                        tokenInput.type = 'text';
                        hfConfigTokenToggleBtn.textContent = 'Hide';
                        hfConfigTokenToggleBtn.title = 'Hide password';
                    } else {
                        tokenInput.type = 'password';
                        hfConfigTokenToggleBtn.textContent = 'Show';
                        hfConfigTokenToggleBtn.title = 'Show password';
                    }
                }
            };
        }
    };
    
    // Setup toggle handlers for workflow and model HF token inputs
    const setupWorkflowHFTokenToggle = () => {
        const toggleBtn = document.getElementById('nitra-workflow-hf-token-toggle');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                const tokenInput = document.getElementById('nitra-workflow-hf-token');
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
    };
    
    const setupModelHFTokenToggle = () => {
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
    };
    
    // Auto-fill HF tokens from user config
    const autoFillHFTokens = async () => {
        try {
            const r = await fetch('/nitra/user-config');
            if (r.ok) {
                const cfg = await r.json();
                if (cfg.huggingface_token && typeof cfg.huggingface_token === 'string' && cfg.huggingface_token.trim()) {
                    const workflowTokenInput = document.getElementById('nitra-workflow-hf-token');
                    const modelTokenInput = document.getElementById('nitra-hf-token');
                    if (workflowTokenInput && !workflowTokenInput.value.trim()) {
                        workflowTokenInput.value = cfg.huggingface_token;
                    }
                    if (modelTokenInput && !modelTokenInput.value.trim()) {
                        modelTokenInput.value = cfg.huggingface_token;
                    }
                }
            }
        } catch (e) {
            // Silently fail - user config might not exist yet
        }
    };

    // Old update button handler removed - now using specific optimizer buttons
    
    // Setup hardcoded optimizer buttons
    const comfyConfigsContainer = updatePanel.querySelector("#nitra-comfy-configs-container");
    if (comfyConfigsContainer) {
        comfyConfigsContainer.innerHTML = `
            <div style="
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 12px;
                align-items: stretch;
                margin-bottom: 16px;
            ">
                <button class="nitra-package-btn" id="nitra-pytorch-btn" style="height: 100%;">Upgrade PyTorch</button>
                <button class="nitra-package-btn" id="nitra-triton-btn" style="height: 100%;">Install Triton Windows</button>
                <button class="nitra-package-btn" id="nitra-sage-btn" style="height: 100%;">Install SageAttention</button>
                <button class="nitra-package-btn" id="nitra-onnx-btn" style="height: 100%;">ONNX Fix (Fix Slow Pose and Depth)</button>
            </div>
        `;
        
        // Add hover effects
        const buttons = comfyConfigsContainer.querySelectorAll('.nitra-package-btn');
        buttons.forEach(btn => {
            btn.addEventListener('mouseover', function() {
                this.style.transform = 'translateY(-2px)';
            });
            btn.addEventListener('mouseout', function() {
                this.style.transform = 'translateY(0)';
            });
        });
        
        // Wire up button handlers
        updatePanel.querySelector('#nitra-pytorch-btn').onclick = () => showPyTorchModal();
        updatePanel.querySelector('#nitra-sage-btn').onclick = () => showSageAttentionModal();
        updatePanel.querySelector('#nitra-onnx-btn').onclick = () => showONNXModal();
        updatePanel.querySelector('#nitra-triton-btn').onclick = () => showTritonWindowsModal();
    }

    const optimizerPanel = updatePanel.querySelector('#nitra-optimizer-content');
    let advancedSection = optimizerPanel?.querySelector('#nitra-advanced-tools-section');
    if (optimizerPanel && !advancedSection) {
        advancedSection = document.createElement('div');
        advancedSection.id = 'nitra-advanced-tools-section';
        optimizerPanel.appendChild(advancedSection);
    }
    if (advancedSection) {
        advancedSection.style.marginTop = '32px';
        advancedSection.innerHTML = `
            <h4 style="
                margin: 0 0 6px 0;
                color: #ffffff;
                font-size: 1em;
                letter-spacing: 0.05em;
                text-transform: uppercase;
            ">Advanced Tools</h4>
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 0.85em;">
                Use these tools for low-level maintenance. Changes may modify your CUDA environment, use at your own risk.
            </p>
            <div style="
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 12px;
                align-items: stretch;
            ">
                <button class="nitra-package-btn" id="nitra-advanced-cuda-btn" style="width: 100%; height: 100%;">CUDA Toolkit Manager</button>
                <button class="nitra-package-btn" id="nitra-advanced-vs-btn" style="width: 100%; height: 100%;">Install Microsoft Build Tools</button>
                <button class="nitra-package-btn" id="nitra-advanced-vs-shell-btn" style="width: 100%; height: 100%;">Open Build Tools Shell</button>
            </div>
        `;
    }

    const advancedCudaBtn = updatePanel.querySelector('#nitra-advanced-cuda-btn');
    if (advancedCudaBtn && !advancedCudaBtn.dataset.bound) {
        advancedCudaBtn.dataset.bound = 'true';
        advancedCudaBtn.onclick = () => showCudaToolkitModal();
    }

    const advancedVsBtn = updatePanel.querySelector('#nitra-advanced-vs-btn');
    if (advancedVsBtn && !advancedVsBtn.dataset.bound) {
        advancedVsBtn.dataset.bound = 'true';
        advancedVsBtn.onclick = () => showBuildToolsModal();
    }

    const advancedVsShellBtn = updatePanel.querySelector('#nitra-advanced-vs-shell-btn');
    if (advancedVsShellBtn && !advancedVsShellBtn.dataset.bound) {
        advancedVsShellBtn.dataset.bound = 'true';
        advancedVsShellBtn.onclick = () => showBuildToolsShellModal();
    }
    
    const updateNitraButtonState = async (button) => {
        if (!button) return;
        const originalText = button.dataset.originalText || button.textContent;
        const originalTitle = button.dataset.originalTitle !== undefined
            ? button.dataset.originalTitle
            : (button.getAttribute('title') || '');
        button.dataset.originalText = originalText;
        button.dataset.originalTitle = originalTitle;

        try {
            const response = await fetch('/nitra/check-nitra-updates', {
                method: 'GET',
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const parsedBehind = Number(data?.behind);
            const behind = Number.isFinite(parsedBehind) ? parsedBehind : 0;

            if (data.updatesAvailable) {
                button.classList.add('nitra-btn-update-available');
                const suffix = behind > 0 ? ` (${behind} update${behind === 1 ? '' : 's'} available)` : '';
                button.textContent = `${originalText}${suffix}`;
                button.title = behind > 0
                    ? `Updates available: ${behind} commit${behind === 1 ? '' : 's'} behind ${data.upstream || 'origin'}`
                    : 'Updates available';
            } else {
                button.classList.remove('nitra-btn-update-available');
                button.textContent = originalText;
                button.title = originalTitle;
            }
        } catch (error) {
            console.error('Nitra: Failed to check Nitra updates', error);
            button.classList.remove('nitra-btn-update-available');
            button.textContent = button.dataset.originalText;
            button.title = 'Unable to check for updates';
        }
    };
    
    // Optimizer Update Nitra Button
    const optimizerUpdateNitraBtn = updatePanel.querySelector("#nitra-optimizer-update-nitra-btn");
    if (optimizerUpdateNitraBtn) {
        optimizerUpdateNitraBtn.onclick = async () => {
            await handleOptimizerUpdateNitra(optimizerUpdateNitraBtn);
            await updateNitraButtonState(optimizerUpdateNitraBtn);
        };
        updateNitraButtonState(optimizerUpdateNitraBtn);
    }
    
    // Optimizer Update Button
    const optimizerUpdateBtn = updatePanel.querySelector("#nitra-optimizer-update-btn");
    if (optimizerUpdateBtn) {
        optimizerUpdateBtn.onclick = () => handleOptimizerUpdate(optimizerUpdateBtn);
    }
    
    // Optimizer Restart Button
    const optimizerRestartBtn = updatePanel.querySelector("#nitra-optimizer-restart-btn");
    if (optimizerRestartBtn) {
        optimizerRestartBtn.onclick = () => handleOptimizerRestart(optimizerRestartBtn);
    }
    
    // Optimizer Refresh Button
    const optimizerRefreshBtn = updatePanel.querySelector("#nitra-optimizer-refresh-btn");
    if (optimizerRefreshBtn) {
        optimizerRefreshBtn.onclick = () => handleOptimizerRefresh();
    }
    
    
    // Add event listeners for install/download buttons
    const installWorkflowsBtn = updatePanel.querySelector("#nitra-install-workflows-btn");
    if (installWorkflowsBtn) {
        installWorkflowsBtn.onclick = async () => {
            if (state.ongoingWorkflowInstall) {
                // Cancel operation
                cancelWorkflowInstall();
                return;
            }
            
            if (state.selectedWorkflows.size === 0) {
                alert("Please select at least one workflow to install.");
                return;
            }
        
            const button = installWorkflowsBtn;
            const originalText = button.textContent;
            
            try {
                // Get HuggingFace token BEFORE clearing it
                const hfTokenInput = document.getElementById('nitra-workflow-hf-token');
                const hfToken = hfTokenInput ? hfTokenInput.value.trim() : '';
                
                const requiresHfToken = await checkWorkflowsForHFTokenRequirement();
                if (requiresHfToken && !hfToken) {
                    showHuggingFaceTokenPrompt({ context: 'workflow' });
                    return;
                }

                // Start installation
                state.setOngoingWorkflowInstall(true);
                
                button.disabled = false;
                button.textContent = "Cancel Install";
                button.style.background = "#dc3545"; // Red for cancel
                
                // Update button state (this will clear the HF token input)
                updateWorkflowInstallButton();
                
                const response = await fetch('/nitra/install/workflow', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.currentUser.apiToken}`
                    },
                    body: JSON.stringify({
                        workflow_ids: Array.from(state.selectedWorkflows),
                        user_id: state.currentUser.id,
                        user_email: state.currentUser.email,
                        hf_token: hfToken
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`Installation failed: ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.status === 'started') {
                    // Keep ongoingWorkflowInstall = true, so updateWorkflowInstallButton shows "Cancel Install"
                    updateWorkflowInstallButton();
                    // Start polling for completion
                    pollForWorkflowCompletion(button, originalText);
                } else if (result.status === 'completed') {
                    state.setOngoingWorkflowInstall(false);
                    button.textContent = "Installation Complete!";
                    button.style.background = "#28a745";
                    setTimeout(() => {
                        resetWorkflowInstallButton(button, originalText);
                    }, 3000);
                } else {
                    throw new Error(result.message || "Installation failed");
                }
                
            } catch (error) {
                console.error("Error installing workflows:", error);
                state.setOngoingWorkflowInstall(false);
                button.disabled = false;
                button.textContent = originalText;
                button.style.background = "#D14E72";
                alert(`Failed to install workflows: ${error.message}`);
                updateWorkflowInstallButton();
            }
        };
    }
    
    const downloadModelsBtn = updatePanel.querySelector("#nitra-download-models-btn");
    if (downloadModelsBtn) {
        downloadModelsBtn.onclick = async () => {
            if (state.ongoingModelDownload) {
                // Cancel operation
                cancelModelDownload();
                return;
            }
            
            if (state.selectedModels.size === 0) {
                alert("Please select at least one model to download.");
                return;
            }
            
            const button = downloadModelsBtn;
            const originalText = button.textContent;
            
            try {
                // Get HuggingFace token BEFORE clearing it
                const hfTokenInput = document.getElementById('nitra-hf-token');
                const hfToken = hfTokenInput ? hfTokenInput.value.trim() : '';
                
                const modelsRequireHfToken = Array.from(state.selectedModels).some(modelId => {
                    const model = state.modelsData.find(m => m && m.id === modelId);
                    return model && model.hfTokenRequired;
                });
                if (modelsRequireHfToken && !hfToken) {
                    showHuggingFaceTokenPrompt({ context: 'model' });
                    return;
                }

                // Start download
                state.setOngoingModelDownload(true);
                
                button.disabled = false;
                button.textContent = "Cancel Download";
                button.style.background = "#dc3545"; // Red for cancel
                
                // Update button state (this will clear the HF token input)
                updateModelDownloadButton();
                
                const response = await fetch('/nitra/install/models', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.currentUser.apiToken}`
                    },
                    body: JSON.stringify({
                        model_ids: Array.from(state.selectedModels),
                        user_id: state.currentUser.id,
                        user_email: state.currentUser.email,
                        hf_token: hfToken
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`Download failed: ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.status === 'started') {
                    // Keep ongoingModelDownload = true, so updateModelDownloadButton shows "Cancel Download"
                    updateModelDownloadButton();
                    // Start polling for completion
                    pollForModelCompletion(button, originalText);
                } else if (result.status === 'completed') {
                    state.setOngoingModelDownload(false);
                    button.textContent = "Download Complete!";
                    button.style.background = "#28a745";
                    setTimeout(() => {
                        resetModelDownloadButton(button, originalText);
                    }, 3000);
                } else {
                    throw new Error(result.message || "Download failed");
                }
                
            } catch (error) {
                console.error("Error downloading models:", error);
                state.setOngoingModelDownload(false);
                button.disabled = false;
                button.textContent = originalText;
                button.style.background = "#D14E72";
                alert(`Failed to download models: ${error.message}`);
                updateModelDownloadButton();
            }
        };
    }
    
    return updatePanel;
}

