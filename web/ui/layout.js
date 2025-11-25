// Layout calculation utilities
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

export function calculateListHeight() {
    const headerHeight = 80; // Approximate header height
    const searchHeight = 60; // Search bar height
    const bottomSectionHeight = 120; // Fixed bottom section height
    const padding = 64; // Total padding (32px * 2)
    
    const availableHeight = window.innerHeight - headerHeight - searchHeight - bottomSectionHeight - padding;
    return Math.max(300, availableHeight); // Minimum 300px height
}

export function updateListHeights() {
    const listHeight = calculateListHeight();
    const workflowsList = document.getElementById('nitra-workflows-list');
    const modelsList = document.getElementById('nitra-models-list');
    
    if (workflowsList) {
        workflowsList.style.maxHeight = `${listHeight}px`;
    }
    if (modelsList) {
        modelsList.style.maxHeight = `${listHeight}px`;
    }
}










