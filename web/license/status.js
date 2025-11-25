// License status management
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { API_ENDPOINTS } from '../core/constants.js';
import { updateLicenseStatusDisplay } from './ui.js';

export async function fetchLicenseStatus() {
    if (!state.isAuthenticated || !state.currentUser || !state.currentUser.apiToken) {
        return null;
    }

    try {
        const response = await fetch(API_ENDPOINTS.licenseStatus, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            },
            body: JSON.stringify({
                userId: state.currentUser.id
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Nitra: Subscription check failed:", {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            return null;
        }
        
        const subscriptionData = await response.json();
        state.setCurrentLicenseStatus(subscriptionData);
        formatLicenseStatus(subscriptionData);
        updateLicenseStatusDisplay();
        return subscriptionData;
    } catch (error) {
        console.error("Nitra: Error fetching subscription status:", error);
        return null;
    }
}

export function formatLicenseStatus(subscriptionData) {
    if (!subscriptionData) {
        return {
            message: "Subscription status unavailable",
            style: "color: #bdbdbd; font-style: italic;",
            showPurchaseLink: false
        };
    }
    
    
    // Handle your website's subscription data format
    const hasPaidSubscription = subscriptionData.has_paid_subscription || false;
    const subscriptionType = subscriptionData.subscription_type || "none";
    const status = subscriptionData.status || "none";
    const endDate = subscriptionData.end_date;
    const subscriptionId = subscriptionData.subscription_id;
    const productId = subscriptionData.product_id;
    
    
    let details = [];
    if (endDate) {
        const endDateObj = new Date(endDate);
        details.push(`Expires: ${endDateObj.toLocaleDateString()}`);
    }
    
    let fullMessage = "";
    let style = "";
    let showPurchaseLink = false;
    
    if (subscriptionType === "none" || status === "none") {
        fullMessage = ` No Subscription Found`;
        style = "color: #bdbdbd; font-weight: 500;";
        showPurchaseLink = true;
    } else if ((hasPaidSubscription && status === "active") || status === "paid") {
        fullMessage = ` Premium Subscription`;
        style = "color: #4ade80; font-weight: 600;";
        showPurchaseLink = false;
    } else if (status === "cancelled") {
        fullMessage = ` Subscription Cancelled`;
        style = "color: #ffffff; font-weight: 500;";
        showPurchaseLink = true;
    } else if (subscriptionType === "free" && status === "active") {
        fullMessage = ` Free Version`;
        style = "color: #ef4444; font-weight: 600;";
        showPurchaseLink = true;
    } else {
        fullMessage = `❓ Subscription Status: ${status} (Type: ${subscriptionType})`;
        style = "color: #ffffff; font-weight: 500;";
        showPurchaseLink = true;
    }
    
    if (details.length > 0) {
        fullMessage += `<br><span style="color: #bdbdbd; font-weight: 500; font-size: 0.95em;">${details.join(' • ')}</span>`;
    }
    
    const result = {
        message: fullMessage,
        style: style,
        showPurchaseLink: showPurchaseLink
    };
    
    return result;
}

