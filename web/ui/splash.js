// Splash screen logic
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { handleWebsiteCallbackFromUrl } from '../auth/oauth.js';
import { checkWebsiteSession } from '../auth/session.js';
// import { fetchLicenseStatus } from '../license/status.js';
import { createSplashDialog, updateDialogForAuthenticated } from './dialog.js';
import { createLoginForm } from './loginForm.js';
import { createUpdateInterface } from './updateInterface.js';
import { ensureDataPrefetch } from '../core/preload.js';

let currentDialogBuild = null;

export async function showNitraSplash() {
    // Check for token callback from your website
    let shouldFetchLicense = false;
    if (window.location.search.includes('token=') || window.location.hash.includes('token=')) {
        try {
            const success = handleWebsiteCallbackFromUrl(updateDialogForAuthenticated);
            if (success) {
                shouldFetchLicense = true;
            }
        } catch (error) {
            console.error("Nitra: Callback error", error);
        }
    }
    
    if (!state.isAuthenticated) {
        // Only try to restore session if we have a stored token
        const storedApiToken = localStorage.getItem('api_token');
        if (storedApiToken) {
            const sessionValid = await checkWebsiteSession();
            if (sessionValid) {
                shouldFetchLicense = true;
            }
        }
    } else {
        // Already authenticated, should fetch license
        shouldFetchLicense = true;
    }
    
    if (currentDialogBuild) {
        try {
            await currentDialogBuild;
        } catch (error) {
            console.warn("Nitra: Previous dialog build failed", error);
        }
    }
    
    clearExistingDialog();
    
    const buildPromise = buildAndMountDialog(createSplashDialog, shouldFetchLicense);
    currentDialogBuild = buildPromise;
    
    try {
        await buildPromise;
    } catch (error) {
        console.error("Nitra: Error creating dialog:", error);
        clearExistingDialog();
        throw error;
    } finally {
        if (currentDialogBuild === buildPromise) {
            currentDialogBuild = null;
        }
    }
}

async function buildAndMountDialog(dialogFactory, shouldFetchLicense) {
    const { dialog, body } = dialogFactory();
    const targetParent = document.body;
    targetParent.appendChild(dialog);
    state.setNitraDialog(dialog);
    try {
        await populateDialogBody(body, shouldFetchLicense);
    } catch (error) {
        console.error("Nitra: Failed to populate dialog body", error);
        clearExistingDialog();
        throw error;
    }
}

async function populateDialogBody(body, shouldFetchLicense) {
    if (state.isAuthenticated) {
        body.style.cssText = `
            display: flex;
            flex-direction: row;
            flex: 1;
            overflow: hidden;
            align-items: stretch;
            justify-content: center;
            align-content: center;
            min-height: 0;
            position: relative;
            width: 100%;
            height: 100%;
        `;

        ensureDataPrefetch();

        // License check is now handled within createUpdateInterface to ensure correct UI state
        // before rendering tabs.
        
        body.appendChild(createUpdateInterface());
    } else {
        body.style.cssText = `
            display: flex;
            flex-direction: row;
            flex: 1;
            overflow: auto;
            align-items: center;
            justify-content: center;
            min-height: 0;
            position: relative;
            padding: 20px;
            width: 100%;
        `;
        body.appendChild(createLoginForm());
    }
}

function clearExistingDialog() {
    const existingDialogs = document.querySelectorAll('.nitra-splash-dialog');
    if (existingDialogs.length) {
        existingDialogs.forEach(dialog => {
            if (dialog.parentElement) {
                dialog.parentElement.removeChild(dialog);
            } else {
                dialog.remove();
            }
        });
    }
    state.setNitraDialog(null);
}


