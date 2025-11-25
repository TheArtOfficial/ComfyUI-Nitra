// Model UI rendering (REFACTORED with component library)
// Clean version using nitra components

import * as state from '../core/state.js';
import { updateModelDownloadButton } from './selection.js';
import { div } from '../ui/components/core.js';
import { ListItem } from '../ui/components/ListItem.js';

export function renderModels() {
    const modelsList = document.getElementById('nitra-models-list');
    if (!modelsList) return;
    
    if (state.modelsData.length === 0) {
        modelsList.innerHTML = '';
        modelsList.appendChild(
            div(
                { className: 'nitra-text-center', style: { padding: '20px' } },
                'No models available'
            )
        );
        return;
    }
    
    const searchTerm = document.getElementById('nitra-model-search')?.value.toLowerCase() || '';
    
    const filteredModels = state.modelsData.filter(model => 
        model.modelName?.toLowerCase().includes(searchTerm) || 
        model.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
    );
    
    // Clear and rebuild list using components
    modelsList.innerHTML = '';
    
    filteredModels.forEach(model => {
        const sizeText = `Install folder: ${model.installFolder || 'default'} • Size: ${model.size ? model.size.toFixed(1) + ' GB' : 'Unknown'}`;
        
        const listItem = ListItem({
            id: model.id,
            title: model.modelName || 'Unnamed Model',
            description: model.notes || 'No description available',
            meta: sizeText,
            tags: model.tags || [],
            checked: state.selectedModels.has(model.id),
            onChange: (checked) => {
                if (checked) {
                    state.selectedModels.add(model.id);
                } else {
                    state.selectedModels.delete(model.id);
                }
                updateModelDownloadButton();
            }
        });
        
        modelsList.appendChild(listItem);
    });
    
    // Add search functionality
    const searchInput = document.getElementById('nitra-model-search');
    if (searchInput) {
        searchInput.oninput = () => renderModels();
    }
    
    // Add deselect all functionality
    const deselectAllBtn = document.getElementById('nitra-deselect-all-models');
    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            state.selectedModels.clear();
            renderModels(); // Re-render to update checkboxes
            updateModelDownloadButton();
        };
    }
    
    updateModelDownloadButton();
}










