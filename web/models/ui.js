// Model UI rendering
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { updateModelDownloadButton } from './selection.js';

const escapeAttr = (value) => {
    if (!value && value !== 0) return '';
    return String(value).replace(/"/g, '&quot;');
};

const modelColumnWidths = new Map();
const COLUMN_DEFAULT_WIDTHS = {
    0: 48,
    1: 260,
    2: 120,
    3: 160,
};

const getColumnWidth = (index) => {
    if (modelColumnWidths.has(index)) {
        return modelColumnWidths.get(index);
    }
    return COLUMN_DEFAULT_WIDTHS[index] || null;
};

const columnStyleAttr = (index, extraStyles = '') => {
    const width = getColumnWidth(index);
    const styles = [];
    if (extraStyles) {
        styles.push(extraStyles.trim());
    }
    if (width) {
        styles.push(`width:${width}px`, `max-width:${width}px`);
    }
    if (!styles.length) {
        return '';
    }
    return `style="${styles.join('; ')}"`;
};

const headerCell = (index, label, resizable = true) => {
    const widthAttr = columnStyleAttr(index);
    const handle = resizable ? '<span class="nitra-column-resize-handle"></span>' : '';
    return `<th ${widthAttr} data-column-index="${index}" data-resizable="${resizable}">
        <div class="nitra-model-header-label">${label}</div>
        ${handle}
    </th>`;
};

export function renderModels() {
    const modelsList = document.getElementById('nitra-models-list');
    if (!modelsList) return;
    
    // Ensure modelsData is an array
    if (!Array.isArray(state.modelsData)) {
        modelsList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--comfy-input-text);">Loading models...</div>';
        return;
    }
    
    if (state.modelsData.length === 0) {
        modelsList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--comfy-input-text);">No models available</div>';
        return;
    }
    
    const rawSearch = document.getElementById('nitra-model-search')?.value || '';
    const searchTerm = rawSearch.toLowerCase().trim();
    const folderFilterEl = document.getElementById('nitra-model-folder-filter');
    let selectedInstallFolder = folderFilterEl ? folderFilterEl.value : '';
    
    // Populate install folder dropdown options dynamically
    if (folderFilterEl) {
        const uniqueFolders = Array.from(new Set(
            state.modelsData
                .map(model => (model.installFolder || '').trim())
                .filter(folder => folder.length > 0)
        )).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        
        const previousValue = selectedInstallFolder;
        const options = ['<option value="">All Model Types</option>']
            .concat(uniqueFolders.map(folder => `<option value="${escapeAttr(folder)}">${escapeAttr(folder)}</option>`))
            .join('');
        
        folderFilterEl.innerHTML = options;
        if (previousValue && uniqueFolders.includes(previousValue)) {
            folderFilterEl.value = previousValue;
        } else {
            folderFilterEl.value = '';
        }
        selectedInstallFolder = folderFilterEl.value;
    }
    
    const filteredModels = state.modelsData.filter(model => {
        const installFolder = (model.installFolder || '').trim();
        if (selectedInstallFolder && installFolder !== selectedInstallFolder) {
            return false;
        }
        
        if (!searchTerm) return true;

        const nameMatch = (model.modelName || model.name || '').toLowerCase().includes(searchTerm);
        const descriptionMatch = (model.notes || model.description || '').toLowerCase().includes(searchTerm);
        const tagMatch = Array.isArray(model.tags)
            ? model.tags.some(tag => (tag || '').toLowerCase().includes(searchTerm))
            : false;

        return nameMatch || descriptionMatch || tagMatch;
    });
    
    // Check if any models are in preview mode
    const inPreviewMode = filteredModels.some(m => m._previewMode);
    
    if (filteredModels.length === 0) {
        modelsList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--comfy-input-text);">No models match your search.</div>';
    } else {
        const tableRows = filteredModels.map(model => {
            const isPreview = model._previewMode;
            const rowClasses = ['nitra-model-row'];
            if (isPreview) {
                rowClasses.push('nitra-model-row-disabled');
            }
            const lockIcon = isPreview ? ' 🔒' : '';
            const modelSize = typeof model.size === 'number' ? `${model.size.toFixed(1)} GB` : '—';
            const installFolder = model.installFolder || '—';
            const description = model.notes || model.description || 'No description available';
            
            const previewNote = isPreview
                ? '<div class="nitra-model-preview-note">Subscribe to download</div>'
                : '';
            
            return `
                <tr class="${rowClasses.join(' ')}" ${!isPreview ? `onclick="document.getElementById('model-${model.id}').click();"` : ''}>
                    <td class="nitra-model-cell nitra-model-checkbox-cell" ${columnStyleAttr(0)} title="Select this model for download">
                        <input type="checkbox" id="model-${model.id}" value="${model.id}" ${isPreview ? 'disabled' : 'onclick="event.stopPropagation();"'} />
                    </td>
                    <td class="nitra-model-cell nitra-model-name-cell" ${columnStyleAttr(1)} title="${escapeAttr(model.modelName || model.name || 'Unnamed Model')}">
                        <div class="nitra-model-name">${model.modelName || model.name || 'Unnamed Model'}${lockIcon}</div>
                        ${previewNote}
                    </td>
                    <td class="nitra-model-cell nitra-model-size-cell" ${columnStyleAttr(2)} title="${escapeAttr(modelSize)}">${modelSize}</td>
                    <td class="nitra-model-cell nitra-model-folder-cell" ${columnStyleAttr(3)} title="${escapeAttr(installFolder)}">${installFolder}</td>
                    <td class="nitra-model-cell nitra-model-description-cell" title="${escapeAttr(description)}">${description}</td>
                </tr>
            `;
        }).join('');
        
        modelsList.innerHTML = `
            <div class="nitra-models-table-wrapper">
                <table class="nitra-models-table">
                    <thead>
                        <tr>
                            ${headerCell(0, '', false)}
                            ${headerCell(1, 'Model Name')}
                            ${headerCell(2, 'Size')}
                            ${headerCell(3, 'Model Type')}
                            ${headerCell(4, 'Description')}
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;
        setupModelColumnResizers();
    }
    
    // Show upgrade prompt if in preview mode
    if (inPreviewMode) {
        const upgradePrompt = document.createElement('div');
        upgradePrompt.style.cssText = `
            background: linear-gradient(135deg, rgba(160, 187, 196, 0.1), rgba(209, 78, 114, 0.1));
            border: 1px solid rgba(160, 187, 196, 0.3);
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
            text-align: center;
        `;
        upgradePrompt.innerHTML = `
            <div style="font-size: 16px; font-weight: 600; color: #ffffff; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em;">
                🌟 Unlock All Models
            </div>
            <div style="color: rgba(255, 255, 255, 0.8); margin-bottom: 12px; font-size: 14px;">
                Subscribe to download and use these models in ComfyUI
            </div>
            <button onclick="window.open('${getWebsiteBaseUrl()}/#pricing', '_blank')" 
                style="background: #0b0b0b; color: #ffffff; border: 1px solid #ffffff; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">
                View Subscription Plans
            </button>
        `;
        modelsList.insertBefore(upgradePrompt, modelsList.firstChild);
    }
    
    // Add event listeners to checkboxes (only for non-preview items)
    filteredModels.forEach(model => {
        const checkbox = document.getElementById(`model-${model.id}`);
        if (checkbox && !model._previewMode) {
            checkbox.checked = state.selectedModels.has(model.id);
            checkbox.onchange = () => {
                if (checkbox.checked) {
                    state.selectedModels.add(model.id);
                } else {
                    state.selectedModels.delete(model.id);
                }
                updateModelDownloadButton();
            };
        }
    });
    
    // Add search functionality
    const searchInput = document.getElementById('nitra-model-search');
    if (searchInput) {
        searchInput.oninput = () => renderModels();
    }
    if (folderFilterEl) {
        folderFilterEl.onchange = () => renderModels();
    }
    
    // Add select all functionality
    const selectAllBtn = document.getElementById('nitra-select-all-models');
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            filteredModels
                .filter(model => !model._previewMode)
                .forEach(model => state.selectedModels.add(model.id));
            renderModels();
            updateModelDownloadButton();
        };
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

function setupModelColumnResizers() {
    const table = document.querySelector('.nitra-models-table');
    if (!table) {
        return;
    }

    const headers = table.querySelectorAll('th[data-resizable="true"]');
    headers.forEach((th) => {
        const handle = th.querySelector('.nitra-column-resize-handle');
        if (!handle || handle.dataset.bound === 'true') {
            return;
        }
        handle.dataset.bound = 'true';
        handle.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const columnIndex = Number(th.dataset.columnIndex);
            const startX = event.clientX;
            const startWidth = th.offsetWidth;
            handle.classList.add('is-resizing');

            const onMouseMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const newWidth = Math.max(80, startWidth + delta);
                th.style.width = `${newWidth}px`;
                table.querySelectorAll(`tbody tr td:nth-child(${columnIndex + 1})`).forEach((td) => {
                    td.style.width = `${newWidth}px`;
                    td.style.maxWidth = `${newWidth}px`;
                });
                modelColumnWidths.set(columnIndex, newWidth);
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                handle.classList.remove('is-resizing');
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}










