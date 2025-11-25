// Authentication callback processing
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { autoSyncDeviceRegistration, sendLoginTelemetry } from '../device/api.js';
import {
    persistUserProfile,
    clearStoredUserProfile,
    decodeTokenExpiry,
} from './storage.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Match website session cookie (7 days)

async function runPostLoginEffects() {
    try {
        await autoSyncDeviceRegistration();
    } catch (error) {
        console.warn("Nitra: Device auto-sync skipped", error);
    }

    await sendLoginTelemetry();
}

function clearStoredSession() {
    try {
        localStorage.removeItem('api_token');
        localStorage.removeItem('user_token');
        localStorage.removeItem('auth_access_token');
        localStorage.removeItem('auth_expires_at');
    } catch (storageError) {
        console.warn("Nitra: Failed to clear stored auth session", storageError);
    }
    clearStoredUserProfile();
}

export async function processWebsiteAuthSuccess(authData) {
    try {
        
        // Store the tokens from your website
        localStorage.setItem('api_token', authData.api_token);
        if (authData.user_token) {
            localStorage.setItem('user_token', authData.user_token);
        }
        const expiryTime = decodeTokenExpiry(authData.api_token) ?? (Date.now() + SESSION_TTL_MS);
        localStorage.setItem('auth_expires_at', String(expiryTime));
        
        // Verify token was stored correctly
        const storedApiToken = localStorage.getItem('api_token');
        
        // Fetch user info from your website's API using the user token
        try {
            if (!authData.api_token) {
                throw new Error("No API token provided for API call");
            }
            
            
            const userResponse = await fetch(getWebsiteBaseUrl() + '/api/user/info', {
                headers: {
                    'Authorization': `Bearer ${authData.api_token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            
            if (userResponse.ok) {
                const user = await userResponse.json();
                
                
                persistUserProfile(
                    {
                        id: user.sub,
                        name: user.name,
                        email: user.email,
                        picture: user.picture,
                        email_verified: user.email_verified,
                    },
                    {
                        apiToken: authData.api_token,
                        accessToken: authData.api_token,
                        userToken: authData.user_token,
                    },
                );
                
                await runPostLoginEffects();
                
                
                // Note: fetchLicenseStatus will be called by the caller after this function returns
                // This avoids circular dependencies with the license module
                
                return true;
            } else {
                const errorText = await userResponse.text();
                console.error("Nitra: API call failed:", {
                    status: userResponse.status,
                    statusText: userResponse.statusText,
                    error: errorText,
                    tokenUsed: authData.api_token ? authData.api_token.substring(0, 20) + "..." : 'none'
                });
                throw new Error(`Failed to fetch user info: ${userResponse.status} - ${errorText}`);
            }
        } catch (error) {
            clearStoredSession();
            throw error;
        }
        
    } catch (error) {
        console.error("Nitra: Error processing website authentication success", error);
        clearStoredSession();
        throw error;
    }
}

export async function processPopupAuthSuccess(authData) {
    try {
        localStorage.setItem('auth_access_token', authData.access_token);
        const expiryTime = decodeTokenExpiry(authData.access_token) ?? (Date.now() + SESSION_TTL_MS);
        localStorage.setItem('auth_expires_at', String(expiryTime));
        
        if (authData.user_info) {
            persistUserProfile(
                {
                    id: authData.user_info.sub,
                    name: authData.user_info.name,
                    email: authData.user_info.email,
                    picture: authData.user_info.picture,
                    provider: authData.user_info.provider,
                },
                {
                    accessToken: authData.access_token,
                    apiToken: authData.access_token,
                    userToken: authData.user_info.id_token,
                },
            );
            
            await runPostLoginEffects();
            
            // Note: fetchLicenseStatus will be called by the caller after this function returns
            
            return true;
        } else if (authData.access_token && authData.access_token.includes('.')) {
            try {
                const tokenParts = authData.access_token.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(atob(tokenParts[1]));
                    
                    state.setAuthenticated(true);
                    persistUserProfile(
                        {
                            id: payload.sub || payload.user_id,
                            name: payload.name || payload.username,
                            email: payload.email,
                            picture: payload.picture || payload.avatar,
                        },
                        {
                            accessToken: authData.access_token,
                            apiToken: authData.access_token,
                            userToken: authData.id_token,
                        },
                    );
                    
                    await runPostLoginEffects();
                    
                    // Note: fetchLicenseStatus will be called by the caller after this function returns
                    
                    return true;
                }
            } catch (jwtError) {
                console.warn("Nitra: Could not decode JWT token:", jwtError);
            }
        }
        
        clearStoredSession();
        throw new Error("Unable to determine authenticated user from the provided token.");
        
    } catch (error) {
        console.error("Nitra: Error processing iframe authentication success", error);
        clearStoredSession();
        throw error;
    }
}

