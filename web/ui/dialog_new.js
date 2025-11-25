// Main dialog creation and management (REFACTORED with component library)
// Clean version using nitra components

import * as state from '../core/state.js';
import { div, h1, p, img } from './components/core.js';
import { createLoginForm } from './loginForm.js';
import { createUpdateInterface } from './updateInterface.js';
import { createCloseButton } from './components/CloseButton.js';

export function createSplashDialog() {
    // Main dialog overlay
    const dialog = div({
        className: 'nitra-splash-dialog',
        style: {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: '#000000',
            backdropFilter: 'blur(8px)',
            zIndex: '10000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.3s ease-out',
            pointerEvents: 'auto'
        }
    });
    
    // Add CSS animations (only add once)
    if (!document.getElementById('nitra-animations')) {
        const style = document.createElement('style');
        style.id = 'nitra-animations';
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideIn {
                from { transform: scale(0.9) translateY(-20px); opacity: 0; }
                to { transform: scale(1) translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Content card
    const content = div({
        className: 'nitra-modern-card',
        style: {
            background: 'var(--nitra-bg-800)',
            border: '1px solid var(--nitra-white-strong)',
            borderRadius: '16px',
            width: '95vw',
            height: '95vh',
            maxWidth: '1400px',
            maxHeight: '95vh',
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideIn 0.4s ease-out',
            position: 'relative'
        }
    });
    
    // Body
    const body = div({
        id: 'nitra-dialog-body',
        style: {
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            overflow: 'hidden',
            alignItems: 'stretch',
            justifyContent: 'flex-start',
            minHeight: 0,
            position: 'relative'
        }
    });
    
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

export function updateDialogForLogin() {
    if (!state.nitraDialog) return;
    const body = state.nitraDialog.querySelector("#nitra-dialog-body");
    body.innerHTML = "";
    body.style.cssText = `
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        align-items: center;
        justify-content: center;
        min-height: 0;
        position: relative;
        padding: 0;
        background: var(--nitra-bg-900);
    `;
    const closeRow = div({
        style: {
            width: '100%',
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '0 8px 16px 0',
            boxSizing: 'border-box'
        }
    }, createCloseButton({ title: 'Close' }));
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










