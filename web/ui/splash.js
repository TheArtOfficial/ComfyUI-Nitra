// Splash screen logic
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { handleWebsiteCallbackFromUrl } from '../auth/oauth.js';
import { checkWebsiteSession } from '../auth/session.js';
import { fetchLicenseStatus } from '../license/status.js';
import { createSplashDialog, updateDialogForAuthenticated } from './dialog.js';
import { createLoginForm } from './loginForm.js';
import { createUpdateInterface } from './updateInterface.js';

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
    
    clearExistingDialog();
    
    try {
        await buildAndMountDialog(createSplashDialog, shouldFetchLicense);
    } catch (error) {
        console.error("Nitra: Error creating dialog:", error);
        clearExistingDialog();
    }
}

async function buildAndMountDialog(dialogFactory, shouldFetchLicense) {
    const { dialog, body } = dialogFactory();
    state.setNitraDialog(dialog);
    await populateDialogBody(body, shouldFetchLicense);
    const targetParent = document.body;
    targetParent.appendChild(dialog);
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

        const loadingContainer = document.createElement('div');
        loadingContainer.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #bdbdbd;
            font-size: 1rem;
            font-weight: 500;
            padding: 24px;
        `;
        loadingContainer.innerHTML = `
            <div style="
                display:flex;
                flex-direction:column;
                align-items:center;
                gap:12px;
                text-align:center;
            ">
                <div style="
                    width:32px;
                    height:32px;
                    border:3px solid rgba(255,255,255,0.2);
                    border-top-color:#ffffff;
                    border-radius:50%;
                    animation:nitra-spin 1s linear infinite;
                "></div>
                <div>Loading your subscription...</div>
            </div>
        `;

        body.appendChild(loadingContainer);

        if (shouldFetchLicense) {
            try {
                await fetchLicenseStatus();
            } catch (err) {
                console.warn("Nitra: License status fetch failed:", err);
            }
        }

        if (loadingContainer.parentElement === body) {
            body.removeChild(loadingContainer);
        }
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
    if (state.nitraDialog && state.nitraDialog.parentElement) {
        state.nitraDialog.parentElement.removeChild(state.nitraDialog);
    }
    state.setNitraDialog(null);
}


