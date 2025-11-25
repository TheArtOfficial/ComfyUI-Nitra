// Workflow UI rendering (REFACTORED with component library)
// Clean version using nitra components

import * as state from '../core/state.js';
import { updateWorkflowInstallButton } from './selection.js';
import { div, input } from '../ui/components/core.js';
import { ListItem } from '../ui/components/ListItem.js';

export function renderWorkflows() {
    const workflowsList = document.getElementById('nitra-workflows-list');
    if (!workflowsList) return;
    
    if (state.workflowsData.length === 0) {
        workflowsList.innerHTML = '';
        workflowsList.appendChild(
            div(
                { className: 'nitra-text-center', style: { padding: '20px' } },
                'No workflows available'
            )
        );
        return;
    }
    
    const searchTerm = document.getElementById('nitra-workflow-search')?.value.toLowerCase() || '';
    const filteredWorkflows = state.workflowsData.filter(workflow => 
        workflow.name?.toLowerCase().includes(searchTerm) || 
        workflow.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
    );
    
    // Clear and rebuild list using components
    workflowsList.innerHTML = '';
    
    filteredWorkflows.forEach(workflow => {
        const sizeText = `Size: ${workflow.modelSize ? workflow.modelSize.toFixed(1) + ' GB' : 'Unknown'}`;
        
        const listItem = ListItem({
            id: workflow.id,
            title: workflow.name || 'Unnamed Workflow',
            description: workflow.description || 'No description available',
            meta: sizeText,
            tags: workflow.tags || [],
            checked: state.selectedWorkflows.has(workflow.id),
            onChange: (checked) => {
                if (checked) {
                    state.selectedWorkflows.add(workflow.id);
                } else {
                    state.selectedWorkflows.delete(workflow.id);
                }
                updateWorkflowInstallButton();
            }
        });
        
        workflowsList.appendChild(listItem);
    });
    
    // Add search functionality
    const searchInput = document.getElementById('nitra-workflow-search');
    if (searchInput) {
        searchInput.oninput = () => {
            renderWorkflows();
            updateWorkflowInstallButton();
        };
    }
    
    // Add deselect all functionality
    const deselectAllWorkflowsBtn = document.getElementById('nitra-deselect-all-workflows');
    if (deselectAllWorkflowsBtn) {
        deselectAllWorkflowsBtn.onclick = () => {
            state.selectedWorkflows.clear();
            renderWorkflows(); // Re-render to update checkboxes
            updateWorkflowInstallButton();
        };
    }
    
    updateWorkflowInstallButton();
}










