// Main dialog creation and management
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { createLoginForm } from './loginForm.js';
import { createUpdateInterface } from './updateInterface.js';
import { createCloseButton } from './components/CloseButton.js';

export function createSplashDialog() {
    const dialog = document.createElement("div");
    dialog.className = "nitra-splash-dialog";
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.15);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease-out;
        pointer-events: auto;
    `;
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: scale(0.9) translateY(-20px); opacity: 0; }
            to { transform: scale(1) translateY(0); opacity: 1; }
        }
        .nitra-modern-card {
            background: #1a1a1a;
            border: 1px solid rgba(160, 187, 196, 0.2);
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(32, 44, 57, 0.3);
            transition: all 0.3s ease;
        }
        .nitra-modern-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 25px 50px rgba(32, 44, 57, 0.4);
        }
        .nitra-modern-button {
            background: #D14E72;
            border: none;
            border-radius: 8px;
            color: #F0F0F0;
            font-weight: 600;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .nitra-modern-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(209, 78, 114, 0.4);
        }
        .nitra-modern-button:active {
            transform: translateY(0);
        }
        .nitra-accent-button {
            background: #A0BBC4;
            border: none;
            border-radius: 8px;
            color: #202C39;
            font-weight: 600;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .nitra-accent-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(160, 187, 196, 0.4);
        }
        .nitra-success-button {
            background: #D14E72;
            border: none;
            border-radius: 8px;
            color: #F0F0F0;
            font-weight: 600;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .nitra-success-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(209, 78, 114, 0.4);
        }
    `;
    document.head.appendChild(style);
    
    const content = document.createElement("div");
    content.className = "nitra-modern-card";
    content.style.cssText = `
        background: #1a1a1a;
        border: 1px solid rgba(160, 187, 196, 0.2);
        border-radius: 16px;
        width: 95vw;
        height: 90vh;
        max-width: 1440px;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 20px 40px rgba(32, 44, 57, 0.5);
        display: flex;
        flex-direction: column;
        animation: slideIn 0.4s ease-out;
        position: relative;
    `;
    
    const body = document.createElement("div");
    body.id = "nitra-dialog-body";
    body.style.cssText = `
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        align-items: stretch;
        justify-content: flex-start;
        min-height: 0;
        position: relative;
    `;
    
    content.appendChild(body);
    dialog.appendChild(content);
    
    const closeOverlay = () => {
        if (dialog.parentElement) {
            dialog.parentElement.removeChild(dialog);
            state.setNitraDialog(null);
        }
    };
    
    // Close on background click
    dialog.onclick = (e) => {
        if (e.target === dialog) {
            closeOverlay();
        }
    };
    
    return { dialog, body };
}

export function createFallbackSplashDialog() {
    const dialog = document.createElement("div");
    dialog.className = "nitra-splash-dialog fallback";
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
    `;

    const content = document.createElement("div");
    content.className = "nitra-modern-card";
    content.style.cssText = `
        background: #141414;
        border: 1px solid rgba(160, 187, 196, 0.35);
        border-radius: 16px;
        width: 92vw;
        height: 90vh;
        max-width: 1300px;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.6);
        display: flex;
        flex-direction: column;
        position: relative;
    `;

    const body = document.createElement("div");
    body.id = "nitra-dialog-body";
    body.style.cssText = `
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        align-items: stretch;
        justify-content: flex-start;
        min-height: 0;
        position: relative;
    `;

    content.appendChild(body);
    dialog.appendChild(content);

    const closeOverlay = () => {
        if (dialog.parentElement) {
            dialog.parentElement.removeChild(dialog);
            state.setNitraDialog(null);
        }
    };

    dialog.onclick = (e) => {
        if (e.target === dialog) {
            closeOverlay();
        }
    };

    return { dialog, body };
}

export function updateDialogForLogin() {
    if (!state.nitraDialog) return;
    const body = state.nitraDialog.querySelector("#nitra-dialog-body");
    body.innerHTML = "";
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
    
    const closeRow = document.createElement('div');
    closeRow.style.cssText = `
        width: 100%;
        display: flex;
        justify-content: flex-end;
        padding: 0 8px 12px 0;
        box-sizing: border-box;
    `;
    closeRow.appendChild(createCloseButton({ title: 'Close' }));
    body.appendChild(closeRow);
    body.appendChild(createLoginForm());
}

export function updateDialogForAuthenticated() {
    if (!state.nitraDialog) return;
    const body = state.nitraDialog.querySelector("#nitra-dialog-body");
    body.innerHTML = "";
    body.style.cssText = `
        display: flex;
        flex-direction: row;
        flex: 1;
        overflow: hidden;
        align-items: stretch;
        justify-content: flex-start;
        min-height: 0;
        position: relative;
        width: 100%;
        height: 100%;
    `;
    body.appendChild(createUpdateInterface());
}


