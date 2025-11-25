// Logout functionality
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';

function clearLocalAuthStorage() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }

    const explicitKeys = [
        'api_token',
        'user_token',
        'auth_access_token',
        'auth_expires_at',
        'oauth_state',
        'nitra_show_splash_after_refresh'
    ];

    const dynamicKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('nitra_')) {
            dynamicKeys.push(key);
        }
    }

    const keysToClear = Array.from(new Set([...explicitKeys, ...dynamicKeys]));
    keysToClear.forEach(key => {
        try {
            window.localStorage.removeItem(key);
        } catch (error) {
            console.warn(`Nitra: Failed to remove localStorage key '${key}'`, error);
        }
    });

    if (typeof window.sessionStorage !== 'undefined') {
        try {
            const sessionKeys = [];
            for (let i = 0; i < window.sessionStorage.length; i++) {
                const key = window.sessionStorage.key(i);
                if (key && key.startsWith('nitra_')) {
                    sessionKeys.push(key);
                }
            }
            sessionKeys.forEach(key => window.sessionStorage.removeItem(key));
        } catch (error) {
            console.warn('Nitra: Failed to clear sessionStorage keys', error);
        }
    }
}

async function triggerWebsiteLogout(logoutUrl) {
    try {
        await fetch(logoutUrl, {
            method: 'GET',
            credentials: 'include',
            mode: 'cors'
        });
        return;
    } catch (error) {
        console.warn('Nitra: logout fetch failed, falling back to iframe', error);
    }

    try {
        await new Promise(resolve => {
            const iframe = document.createElement('iframe');
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.style.position = 'absolute';
            iframe.style.left = '-9999px';
            iframe.src = logoutUrl;

            const cleanup = () => {
                if (iframe && iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
                resolve();
            };

            iframe.onload = cleanup;
            iframe.onerror = cleanup;

            document.body.appendChild(iframe);

            setTimeout(cleanup, 3000);
        });
    } catch (iframeError) {
        console.warn('Nitra: iframe logout fallback failed, opening logout URL directly', iframeError);
    }
}

export async function logoutWebsite() {
    clearLocalAuthStorage();

    const cookiesToClear = [
        'auth_access_token',
        'auth_expires_at',
        'oauth_state'
    ];

    cookiesToClear.forEach(cookieName => {
        document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=localhost;`;
        document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=;`;
    });

    state.setAuthenticated(false);
    state.setCurrentUser(null);
    state.setCurrentLicenseStatus(null);

    if (state.nitraDialog && state.nitraDialog.parentElement) {
        state.nitraDialog.parentElement.removeChild(state.nitraDialog);
        state.setNitraDialog(null);
    }

    const logoutUrl = getWebsiteBaseUrl() + '/api/auth/logout';
    await triggerWebsiteLogout(logoutUrl);
}










