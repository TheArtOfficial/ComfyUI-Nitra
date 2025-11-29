import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { API_ENDPOINTS } from './core/constants.js';
import { fetchConfig, getCallbackUrl, getOAuthConfig, getWebsiteBaseUrl, setWebsiteBaseUrl } from './core/config.js';
import * as state from './core/state.js';
import { loginWithWebsite, handleWebsiteCallbackFromUrl, handlePopupAuthResult } from './auth/oauth.js';
import { checkWebsiteSession, restoreSessionOnLoad, ensureFreshAccessToken } from './auth/session.js';
import { processWebsiteAuthSuccess, processPopupAuthSuccess } from './auth/callbacks.js';
import { logoutWebsite } from './auth/logout.js';
import { fetchLicenseStatus, formatLicenseStatus } from './license/status.js';
import { updateLicenseStatusDisplay } from './license/ui.js';
import { loadWorkflows, getExistingModels, calculateTotalWorkflowSize, checkWorkflowsForHFTokenRequirement } from './workflows/api.js';
import { renderWorkflows } from './workflows/ui.js';
import { updateWorkflowInstallButton } from './workflows/selection.js';
import { pollForWorkflowCompletion, cancelWorkflowInstall, resetWorkflowInstallButton } from './workflows/installation.js';
import { loadModels } from './models/api.js';
import { renderModels } from './models/ui.js';
import { updateModelDownloadButton } from './models/selection.js';
import { pollForModelCompletion, cancelModelDownload, resetModelDownloadButton } from './models/download.js';
import { calculateListHeight as calculateListHeightFromModule, updateListHeights as updateListHeightsFromModule } from './ui/layout.js';
import { createLoginForm as createLoginFormFromModule } from './ui/loginForm.js';
import { createUpdateInterface as createUpdateInterfaceFromModule } from './ui/updateInterface.js';
import { createSplashDialog as createSplashDialogFromModule, updateDialogForLogin as updateDialogForLoginFromModule, updateDialogForAuthenticated as updateDialogForAuthenticatedFromModule } from './ui/dialog.js';
import { showNitraSplash as showNitraSplashFromModule } from './ui/splash.js';
import { showPostRestartRefreshPrompt } from './ui/systemPrompts.js';
import { getActiveApiToken, getStoredUserEmail, getStoredUserId } from './auth/storage.js';

// All UI functions are now imported from ui/ modules
// Using imported versions with aliases to avoid conflicts
const calculateListHeight = calculateListHeightFromModule;
const updateListHeights = updateListHeightsFromModule;
const createLoginForm = createLoginFormFromModule;
const createUpdateInterface = createUpdateInterfaceFromModule;
const createSplashDialog = createSplashDialogFromModule;
const updateDialogForLogin = updateDialogForLoginFromModule;
const updateDialogForAuthenticated = updateDialogForAuthenticatedFromModule;
const showNitraSplash = showNitraSplashFromModule;

async function startUpdate(options) {
    try {
        if (!state.isAuthenticated) {
            throw new Error("Authentication required to start update");
        }
        const sessionValid = await ensureFreshAccessToken();
        if (!sessionValid) {
            throw new Error("Session expired. Please sign in again.");
        }
        const authToken = getActiveApiToken();
        const userId = state.currentUser?.id || getStoredUserId();
        const userEmail = state.currentUser?.email || getStoredUserEmail();
        if (!authToken || !userId) {
            throw new Error("Authentication required to start update");
        }
        
        state.setUpdateInProgress(true);
        
        const executeResponse = await fetch(API_ENDPOINTS.executeComfySetup, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                user_id: userId,
                user_email: userEmail,
                options: options,
                script_filename: 'comfy_setup.py'
            })
        });
        
        if (!executeResponse.ok) {
            if (executeResponse.status === 404) {
                setTimeout(() => {
                    state.setUpdateInProgress(false);
                    showUpdateCompleteNotification();
                }, 15000);
                return true;
            }
            
            throw new Error(`Execute request failed: ${executeResponse.status} - ${executeResponse.statusText}`);
        }
        
        const executeResult = await executeResponse.json();
        
        if (executeResult.status === 'failed' && executeResult.error) {
            state.setUpdateInProgress(false);
            return {
                success: false,
                error: executeResult.error,
                error_type: 'license'
            };
        }
        
        return { success: true };
    } catch (error) {
        console.error("Nitra: Update start error:", error);
        state.setUpdateInProgress(false);
        return false;
    }
}

async function checkUpdateStatus() {
    try {
        const authToken = getActiveApiToken();
        const response = await fetch(API_ENDPOINTS.updateStatus, {
            headers: {
                'Authorization': `Bearer ${authToken || 'no-token'}`
            }
        });
        
        if (response.ok) {
            const status = await response.json();
            return status;
        }
        
        return null;
    } catch (error) {
        console.error("Nitra: Update status check error", error);
        return null;
    }
}

function startUpdateMonitoring(updateButton, statusDiv, originalButtonText) {
    let pollCount = 0;
    const maxPolls = 120;
    
    const pollInterval = setInterval(async () => {
        pollCount++;
        
        try {
            const status = await checkUpdateStatus();
            
            if (status && status.status === 'completed') {
                clearInterval(pollInterval);
                state.setUpdateInProgress(false);
                showUpdateCompleteNotification(updateButton, statusDiv, originalButtonText);
                return;
            } else if (status && status.status === 'failed') {
                clearInterval(pollInterval);
                state.setUpdateInProgress(false);
                
                updateButton.disabled = false;
                updateButton.style.opacity = "1";
                updateButton.style.cursor = "pointer";
                updateButton.textContent = originalButtonText;
                
                if (status.error_type === 'license') {
                    statusDiv.style.background = "#ff4444";
                    statusDiv.style.color = "white";
                    statusDiv.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 16px;">
                            <div style="font-size: 24px;">❌</div>
                            <div style="font-weight: bold; font-size: 16px;">License Required</div>
                            <div style="text-align: center;">${status.error}</div>
                        </div>
                    `;
                } else {
                    statusDiv.style.background = "#A0BBC4";
                    statusDiv.textContent = `Update failed: ${status.error || 'Unknown error'}`;
                }
                return;
            } else if (status && status.status === 'running') {
                const progress = status.progress || Math.round((pollCount / maxPolls) * 90);
                statusDiv.textContent = `${status.message || 'Update in progress...'} ${progress}%`;
            } else {
                const progress = Math.round((pollCount / maxPolls) * 90);
                statusDiv.textContent = `Update in progress... ${progress}% (estimated)`;
            }
            
            if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                state.setUpdateInProgress(false);
                
                updateButton.disabled = false;
                updateButton.style.opacity = "1";
                updateButton.style.cursor = "pointer";
                updateButton.textContent = originalButtonText;
                
                statusDiv.style.background = "#A0BBC4";
                statusDiv.textContent = "Update timeout reached. Check console for details.";
                return;
            }
            
        } catch (error) {
            console.error("Nitra: Update monitoring error:", error);
            clearInterval(pollInterval);
            
            updateButton.disabled = false;
            updateButton.style.opacity = "1";
            updateButton.style.cursor = "pointer";
            updateButton.textContent = originalButtonText;
            
            statusDiv.style.background = "#A0BBC4";
            statusDiv.textContent = "Update monitoring failed. Please check console for details.";
        }
    }, 5000);
}

function showUpdateCompleteNotification(updateButton, statusDiv, originalButtonText) {
    statusDiv.style.background = "#A0BBC4";
    statusDiv.style.color = "white";
    statusDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <span style="font-weight: bold;">Update completed successfully!</span>
            </div>
            <p style="margin: 0; text-align: center; font-size: 0.9em;">
                Your ComfyUI update has finished. Restart is recommended to ensure all changes take effect.
            </p>
            <div style="display: flex; gap: 12px;">
                <button id="nitra-restart-btn" style="
                    padding: 8px 16px;
                    background: #D14E72;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: bold;
                ">Restart ComfyUI</button>
                <button id="nitra-continue-btn" style="
                    padding: 8px 16px;
                    background: #666;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                ">Continue</button>
            </div>
        </div>
    `;
    
    statusDiv.querySelector("#nitra-restart-btn").onclick = async () => {
        if (confirm("Are you sure you want to restart ComfyUI? Any unsaved work will be lost.")) {
            try {
                statusDiv.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #D14E72; font-weight: bold;">
                        🔄 Restarting ComfyUI...
                    </div>
                `;
                
                await fetch('/nitra/restart', { method: 'GET' });
                
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            } catch (error) {
                console.error("Nitra: Restart failed:", error);
                alert("Failed to restart ComfyUI. Please restart manually.");
            }
        }
    };
    
    statusDiv.querySelector("#nitra-continue-btn").onclick = () => {
        updateButton.disabled = false;
        updateButton.style.opacity = "1";
        updateButton.style.cursor = "pointer";
        updateButton.textContent = originalButtonText;
        
        statusDiv.style.display = "none";
        state.setUpdateInProgress(false);
    };
    
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("nitra Update Complete", {
            body: "ComfyUI update has finished successfully!",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23D14E72'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/></svg>"
        });
    } else if ("Notification" in window && Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("nitra Update Complete", {
                    body: "ComfyUI update has finished successfully!"
                });
            }
        });
    }
}

// Load CSS file
function loadNitraCSS() {
    const cssPath = new URL('./nitra.css', import.meta.url).href;
    
    // Check if already loaded
    if (!document.querySelector(`link[href="${cssPath}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = cssPath;
        document.head.appendChild(link);
        console.log('Nitra: CSS loaded from', cssPath);
    }
}

// Load CSS immediately
loadNitraCSS();

function handleApiReconnected() {
    if (state.pendingRefreshAfterRestart) {
        showPostRestartRefreshPrompt();
    }
}

if (api && typeof api.addEventListener === 'function') {
    api.addEventListener('reconnected', handleApiReconnected);
}

// Register the extension with ComfyUI - following SubgraphSearch pattern exactly
app.registerExtension({
    name: "Comfy.AOLabs",
    // Add a command and keybinding so users can open the dialog without clicking the button
    commands: [
        {
            id: "Comfy.AOLabs.Open",
            label: "Open nitra",
            function: () => {
                if (typeof state.openNitraDialog === "function") {
                    state.openNitraDialog();
                } else {
                    console.warn("Nitra: dialog not ready yet");
                }
            }
        }
    ],
    // Default shortcut: Ctrl+L for Labs
    keybindings: [
        {
            commandId: "Comfy.AOLabs.Open",
            combo: { ctrl: true, key: "l" }
        }
    ],

    async setup() {
        // Load configuration from backend first (single source of truth)
        await fetchConfig();
        
        // Assign the dialog function early so it's available for auto-popup
        state.setOpenNitraDialog(showNitraSplash);
        
        // Check for authentication callback and show splash screen if needed
        const hasAuthTokens = window.location.search.includes('token=') || window.location.hash.includes('token=');
        if (hasAuthTokens) {
            console.log("Nitra: Authentication tokens detected in URL, processing callback");
            const success = handleWebsiteCallbackFromUrl(updateDialogForAuthenticated);
            if (success) {
                // Show splash screen after a brief delay to ensure authentication is complete
                // License status will be fetched when splash opens (after DOM creation)
                setTimeout(() => {
                    state.openNitraDialog();
                }, 1000);
            }
        } else if (localStorage.getItem('nitra_show_splash_after_refresh') === 'true') {
            // Show splash screen after refresh
            localStorage.removeItem('nitra_show_splash_after_refresh');
            setTimeout(() => {
                state.openNitraDialog();
            }, 500);
        } else {
            // Only check for existing session if no auth tokens in URL and no refresh flag
            const sessionRestored = await restoreSessionOnLoad();
            // Don't fetch license here - it will be fetched when/if the splash screen opens
        }
        
        window.addEventListener('error', (event) => {
            if (event.error && event.error.message && 
                (event.error.message.includes('message channel closed') || 
                 event.error.message.includes('asynchronous response'))) {
                event.preventDefault();
                return;
            }
        });
        
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason && event.reason.message && 
                (event.reason.message.includes('message channel closed') || 
                 event.reason.message.includes('asynchronous response'))) {
                event.preventDefault();
                return;
            }
        });
        
        window.addEventListener('message', (event) => {
            try {
                handlePopupAuthResult(event, updateDialogForAuthenticated);
                // License status will be fetched when splash opens (after DOM creation)
            } catch (error) {
                if (error.message && error.message.includes('message channel closed')) {
                    return;
                }
                console.error("Nitra: Message handling error:", error);
            }
        }, false);
        
        window.testNitra = () => {
            alert("nitra test function works!");
        };
        
        const menu = document.querySelector(".comfy-menu");
        if (!menu) {
            console.error("Nitra: ComfyUI menu not found!");
            return;
        }
        
        
        // Try multiple approaches to ensure button appears
        let buttonCreated = false;
        
        // Approach 1: Try ComfyUI Button components
        try {
            const Button = (await import("/scripts/ui/components/button.js")).ComfyButton;
            const ButtonGroup = (await import("/scripts/ui/components/buttonGroup.js")).ComfyButtonGroup;
            
            const nitraBtn = new Button({
                icon: null,
                action: () => {
                    if (typeof state.openNitraDialog === "function") {
                        state.openNitraDialog();
                    }
                },
                tooltip: "Open Nitra Control Panel",
                content: "",
                classList: "comfyui-button comfyui-menu-mobile-collapse"
            });
            
            const logoSrc = window?.app?.ui?.getFileUrl
                ? window.app.ui.getFileUrl('extensions/ComfyUI-Nitra/images/NitraNoOutline.png') || 'extensions/ComfyUI-Nitra/images/NitraNoOutline.png'
                : 'extensions/ComfyUI-Nitra/images/NitraNoOutline.png';
            
            const logoImg = document.createElement('img');
            logoImg.src = logoSrc;
            logoImg.alt = 'Nitra';
            logoImg.style.height = '40px';
            logoImg.style.display = 'block';
            
            nitraBtn.element.innerHTML = '';
            nitraBtn.element.appendChild(logoImg);
            nitraBtn.element.style.background = '#ffffff';
            nitraBtn.element.style.border = '0px solid #000000';
            nitraBtn.element.style.borderRadius = '0px';
            nitraBtn.element.style.padding = '0px 0px';
            nitraBtn.element.style.display = 'flex';
            nitraBtn.element.style.alignItems = 'center';
            nitraBtn.element.style.justifyContent = 'center';
            nitraBtn.element.style.minWidth = '95px';
            nitraBtn.element.style.maxWidth = '100px';
            
            
            const group = new ButtonGroup(nitraBtn.element);
            app.menu?.settingsGroup?.element?.before(group.element);
            buttonCreated = true;
        } catch (e) {
            console.log("Nitra: ComfyUI components failed, trying fallback:", e);
        }
        
        // Approach 2: Fallback button creation
        if (!buttonCreated) {
            try {
                console.log("Nitra: Using fallback button creation");
            const btn = document.createElement("button");
            btn.textContent = "nitra";
            btn.onclick = () => {
                if (typeof state.openNitraDialog === "function") {
                    state.openNitraDialog();
                }
            };
            const fallbackLogo = document.createElement('img');
            const fallbackSrc = window?.app?.ui?.getFileUrl
                ? window.app.ui.getFileUrl('extensions/ComfyUI-Nitra/images/NitraNoOutline.png') || 'extensions/ComfyUI-Nitra/images/NitraNoOutline.png'
                : 'extensions/ComfyUI-Nitra/images/NitraNoOutline.png';
            fallbackLogo.src = fallbackSrc;
            fallbackLogo.alt = 'Nitra';
            fallbackLogo.style.height = '28px';
            fallbackLogo.style.display = 'block';
            
            btn.innerHTML = '';
            btn.appendChild(fallbackLogo);
            btn.style.background = '#ffffff';
            btn.style.border = '1px solid #000000';
            btn.style.borderRadius = '8px';
            btn.style.padding = '4px 12px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.minWidth = '120px';
            btn.style.maxWidth = '160px';
            
            menu.append(btn);
                console.log("Nitra: Fallback button created and added to menu");
                buttonCreated = true;
            } catch (e) {
                console.error("Nitra: Fallback button creation failed:", e);
            }
        }
        
        // Approach 3: Try to find existing button and ensure it's visible
        if (!buttonCreated) {
            setTimeout(() => {
                const existingBtn = document.querySelector('button[data-tooltip="nitra - Authentication & Updates"]') || 
                                 document.querySelector('button[style*="background: #D14E72"]');
                if (existingBtn) {
                    console.log("Nitra: Found existing button, ensuring visibility");
                    existingBtn.style.display = "block";
                    existingBtn.style.visibility = "visible";
                    existingBtn.style.opacity = "1";
                }
            }, 1000);
        }
        
        setInterval(async () => {
            if (state.updateInProgress) {
                const status = await checkUpdateStatus();
                if (status && status.completed) {
                    state.setUpdateInProgress(false);
                    showUpdateCompleteNotification();
                }
            }
        }, 5000);
    }
});

// Initialize the system
setup().catch(error => {
    console.error('Nitra: Setup failed:', error);
});

