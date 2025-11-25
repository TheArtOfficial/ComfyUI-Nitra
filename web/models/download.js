// Model download and polling
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { updateModelDownloadButton } from './selection.js';

export async function pollForModelCompletion(button, originalText) {
    // Clear any existing polling
    if (state.modelPollInterval) {
        clearInterval(state.modelPollInterval);
    }
    
    state.setModelPollInterval(setInterval(async () => {
        try {
            const response = await fetch('/nitra/queue/status');
            if (response.ok) {
                const status = await response.json();
                // Polling status logging removed to avoid console spam
                // If queue is empty and no processing and no running processes, download is complete
                if (status.queue_size === 0 && !status.is_processing && status.in_progress_count === 0 && status.running_count === 0) {
                    clearInterval(state.modelPollInterval);
                    state.setModelPollInterval(null);
                    state.setOngoingModelDownload(false);
                    button.textContent = "Download Complete!";
                    button.style.background = "#28a745";
                    setTimeout(() => {
                        resetModelDownloadButton(button, originalText);
                    }, 3000);
                }
            }
        } catch (error) {
            console.error("Error polling model completion:", error);
            clearInterval(state.modelPollInterval);
            state.setModelPollInterval(null);
            state.setOngoingModelDownload(false);
            updateModelDownloadButton();
        }
    }, 2000)); // Poll every 2 seconds
    
    // Stop polling after 10 minutes (safety timeout)
    setTimeout(() => {
        if (state.modelPollInterval) {
            clearInterval(state.modelPollInterval);
            state.setModelPollInterval(null);
        }
        if (state.ongoingModelDownload) {
            state.setOngoingModelDownload(false);
            updateModelDownloadButton();
        }
    }, 600000);
}

export async function cancelModelDownload() {
    try {
        const response = await fetch('/nitra/queue/reset', {
            method: 'GET'
        });
        
        if (response.ok) {
            console.log("Model download cancelled");
            // Stop polling
        if (state.modelPollInterval) {
            clearInterval(state.modelPollInterval);
            state.setModelPollInterval(null);
            }
            // Reset button state
            state.setOngoingModelDownload(false);
            updateModelDownloadButton();
        } else {
            console.error("Failed to cancel model download");
        }
    } catch (error) {
        console.error("Error cancelling model download:", error);
        // Stop polling even on error
        if (state.modelPollInterval) {
            clearInterval(state.modelPollInterval);
            state.setModelPollInterval(null);
        }
        // Reset button state even on error
        state.setOngoingModelDownload(false);
        updateModelDownloadButton();
    }
}

export function resetModelDownloadButton(button, originalText) {
    button.disabled = false;
    button.textContent = originalText;
    button.style.background = "#0b0b0b";
    button.style.color = "#ffffff";
    button.style.border = "1px solid #ffffff";
}










