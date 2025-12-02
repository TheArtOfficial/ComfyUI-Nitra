// Workflow installation and polling
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { updateWorkflowInstallButton } from './selection.js';
import { showRestartPrompt } from '../ui/systemPrompts.js';

export async function pollForWorkflowCompletion(button, originalText) {
    // Clear any existing polling
    if (state.workflowPollInterval) {
        clearInterval(state.workflowPollInterval);
    }
    
    state.setWorkflowPollInterval(setInterval(async () => {
        try {
            const response = await fetch('/nitra/queue/status');
            if (response.ok) {
                const status = await response.json();
                // Polling status logging removed to avoid console spam
                // If queue is empty and no processing and no running processes, installation is complete
                if (status.queue_size === 0 && !status.is_processing && status.in_progress_count === 0 && status.running_count === 0) {
                    clearInterval(state.workflowPollInterval);
                    state.setWorkflowPollInterval(null);
                    state.setOngoingWorkflowInstall(false);
                    button.textContent = "Installation Complete!";
                    button.style.background = "#28a745";
                    setTimeout(() => {
                        resetWorkflowInstallButton(button, originalText);
                    }, 3000);
                    showRestartPrompt({
                        onRestartSuccess: () => state.setPendingRefreshAfterRestart(true),
                    });
                }
            }
        } catch (error) {
            console.error("Error polling workflow completion:", error);
            clearInterval(state.workflowPollInterval);
            state.setWorkflowPollInterval(null);
            state.setOngoingWorkflowInstall(false);
            updateWorkflowInstallButton();
        }
    }, 2000)); // Poll every 2 seconds
    
}

export async function cancelWorkflowInstall() {
    try {
        const response = await fetch('/nitra/queue/reset', {
            method: 'GET'
        });
        
        if (response.ok) {
            console.log("Workflow installation cancelled");
            // Stop polling
        if (state.workflowPollInterval) {
            clearInterval(state.workflowPollInterval);
            state.setWorkflowPollInterval(null);
            }
            // Reset button state
            state.setOngoingWorkflowInstall(false);
            updateWorkflowInstallButton();
            if (typeof state.setPendingRefreshAfterRestart === 'function') {
                state.setPendingRefreshAfterRestart(false);
            }
        } else {
            console.error("Failed to cancel workflow installation");
        }
    } catch (error) {
        console.error("Error cancelling workflow installation:", error);
        // Stop polling even on error
        if (state.workflowPollInterval) {
            clearInterval(state.workflowPollInterval);
            state.setWorkflowPollInterval(null);
        }
        // Reset button state even on error
        state.setOngoingWorkflowInstall(false);
        updateWorkflowInstallButton();
        if (typeof state.setPendingRefreshAfterRestart === 'function') {
            state.setPendingRefreshAfterRestart(false);
        }
    }
}

export function resetWorkflowInstallButton(button, originalText) {
    button.disabled = false;
    button.textContent = originalText;
    button.style.background = "#0b0b0b";
    button.style.color = "#ffffff";
    button.style.border = "1px solid #ffffff";
}










