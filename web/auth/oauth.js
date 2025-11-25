// OAuth authentication flow
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getOAuthConfig, getWebsiteBaseUrl } from '../core/config.js';
import { processWebsiteAuthSuccess, processPopupAuthSuccess } from './callbacks.js';

export function generateState() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export async function loginWithWebsite() {
    try {
        // Generate state for security
        const stateParam = generateState();
        localStorage.setItem('oauth_state', stateParam);
        
        // Get OAuth config (uses current getWebsiteBaseUrl())
        const oauthConfig = getOAuthConfig();
        
        // Redirect to your website's auth route with callback URL
        const authUrl = `${oauthConfig.authUrl}?redirect=${encodeURIComponent(oauthConfig.callbackUrl)}&state=${encodeURIComponent(stateParam)}`;
        
        window.location.href = authUrl;
        return true;
        
    } catch (error) {
        console.error("Nitra: Login error:", error);
        return false;
    }
}

export function handleWebsiteCallbackFromUrl(updateDialogForAuthenticated) {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substr(1));
    
    
    // Check for tokens in URL parameters (from your website)
    const apiToken = urlParams.get('token') || hashParams.get('token');
    const userToken = urlParams.get('id_token') || hashParams.get('id_token');
    const error = urlParams.get('error') || hashParams.get('error');
    const error_description = urlParams.get('error_description') || hashParams.get('error_description');
    const stateParam = urlParams.get('state') || hashParams.get('state');
    
    if (error) {
        console.error("Nitra: Callback error:", error, error_description);
        return false;
    }
    
    if (apiToken) {
        
        // Verify state parameter for security
        const storedState = localStorage.getItem('oauth_state');
        if (stateParam && storedState && stateParam !== storedState) {
            console.error("Nitra: State parameter mismatch");
            return false;
        }
        
        // Clear the state
        localStorage.removeItem('oauth_state');
        
        const authData = {
            api_token: apiToken, // This is the JWT access token with audience for API calls
            user_token: userToken, // This is the Auth0 ID token for user info calls
            user_info: null // Will be fetched from your API
        };
        
        processWebsiteAuthSuccess(authData).then(() => {
            updateDialogForAuthenticated();
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }).catch(error => {
            console.error("Nitra: Error processing callback authentication:", error);
            return false;
        });
        
        return true;
    }
    
    return false;
}

export function handlePopupAuthResult(event, updateDialogForAuthenticated) {
    if (event.origin !== window.location.origin) {
        return;
    }
    
    if (event.data.type === 'NITRA_AUTH_SUCCESS') {
        if (window.nitraAuthPopup && !window.nitraAuthPopup.closed) {
            window.nitraAuthPopup.close();
        }
        
        processPopupAuthSuccess(event.data).then(() => {
            updateDialogForAuthenticated();
            
            if (window.nitraAuthResolve) {
                window.nitraAuthResolve(true);
                window.nitraAuthResolve = null;
                window.nitraAuthReject = null;
            }
        }).catch(error => {
            console.error("Nitra: Error processing authentication success:", error);
            if (window.nitraAuthReject) {
                window.nitraAuthReject(error);
                window.nitraAuthResolve = null;
                window.nitraAuthReject = null;
            }
        });
        
    } else if (event.data.type === 'NITRA_AUTH_ERROR') {
        console.error("Nitra: Popup authentication failed:", event.data.error);
        
        if (window.nitraAuthPopup && !window.nitraAuthPopup.closed) {
            window.nitraAuthPopup.close();
        }
        
        if (window.nitraAuthReject) {
            window.nitraAuthReject(new Error(event.data.error_description || event.data.error));
            window.nitraAuthResolve = null;
            window.nitraAuthReject = null;
        }
    }
}

