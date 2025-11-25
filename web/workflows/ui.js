// Workflow UI rendering
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { updateWorkflowInstallButton } from './selection.js';

let workflowCategoryFilter = 'all';

function renderCategoryFilterOptions(categories) {
    const select = document.getElementById('nitra-workflow-category-filter');
    if (!select) return;

    const uniqueCategories = Array.from(new Set(categories.filter(Boolean).map(category => category.trim()))).filter(Boolean).sort((a, b) => a.localeCompare(b));

    const options = ['<option value="all">All Categories</option>'].concat(
        uniqueCategories.map(category => `<option value="${category}">${category}</option>`)
    );

    select.innerHTML = options.join('');

    if (workflowCategoryFilter !== 'all' && !uniqueCategories.includes(workflowCategoryFilter)) {
        workflowCategoryFilter = 'all';
    }

    select.value = workflowCategoryFilter;

    select.onchange = () => {
        workflowCategoryFilter = select.value;
        renderWorkflows();
    };
}

// Global helpers so inline handlers on cards can control video playback
if (typeof window !== 'undefined') {
    window.nitraPlayWorkflowVideo = function (workflowId) {
        try {
            const el = document.getElementById(`nitra-workflow-video-${workflowId}`);
            if (el && el.paused) {
                el.play().catch(() => {});
            }
        } catch (e) {
            console.warn('Nitra: failed to play workflow video', e);
        }
    };

    window.nitraPauseWorkflowVideo = function (workflowId) {
        try {
            const el = document.getElementById(`nitra-workflow-video-${workflowId}`);
            if (el && !el.paused) {
                el.pause();
                el.currentTime = 0;
            }
        } catch (e) {
            console.warn('Nitra: failed to pause workflow video', e);
        }
    };
}

export function renderWorkflows() {
    const workflowsList = document.getElementById('nitra-workflows-list');
    if (!workflowsList) return;
    
    // Ensure workflowsData is an array
    if (!Array.isArray(state.workflowsData)) {
        workflowsList.innerHTML = '<div class="nitra-centered-placeholder">Loading workflows...</div>';
        return;
    }
    
    if (state.workflowsData.length === 0) {
        workflowsList.innerHTML = '<div class="nitra-centered-placeholder">No workflows available</div>';
        return;
    }
    
    const rawSearch = document.getElementById('nitra-workflow-search')?.value || '';
    const searchTerm = rawSearch.toLowerCase().trim();

    const allCategories = Array.from(new Set(state.workflowsData.flatMap(workflow => Array.isArray(workflow.categories) ? workflow.categories : []).filter(category => typeof category === 'string' && category.trim()))).sort((a, b) => a.localeCompare(b));
    renderCategoryFilterOptions(allCategories);

    const searchedWorkflows = state.workflowsData.filter(workflow => {
        if (!searchTerm) return true;

        const nameMatch = (workflow.name || '').toLowerCase().includes(searchTerm);
        const descriptionMatch = (workflow.description || '').toLowerCase().includes(searchTerm);
        const tagMatch = Array.isArray(workflow.tags)
            ? workflow.tags.some(tag => (tag || '').toLowerCase().includes(searchTerm))
            : false;

        return nameMatch || descriptionMatch || tagMatch;
    });

    const filteredWorkflows = workflowCategoryFilter === 'all'
        ? searchedWorkflows
        : searchedWorkflows.filter(workflow =>
            Array.isArray(workflow.categories)
                ? workflow.categories.some(category => category === workflowCategoryFilter)
                : false
    );
    
    // Check if any workflows are in preview mode
    const inPreviewMode = filteredWorkflows.some(w => w._previewMode);
    
    workflowsList.style.display = 'grid';
    workflowsList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    workflowsList.style.gap = '18px';
    workflowsList.style.padding = '12px 0';
    workflowsList.style.margin = '0';
    
    workflowsList.innerHTML = filteredWorkflows.map(workflow => {
        const isPreview = workflow._previewMode;
        const baseStyle = 'cursor: pointer;';
        const disabledStyle = isPreview ? '' : '';
        const lockIcon = isPreview ? ' 🔒' : '';
        const mediaItems = Array.isArray(workflow.media) ? workflow.media : [];
        const primaryMedia = mediaItems.find(item => item.fileUrl) || mediaItems[0];
        const mediaUrl = primaryMedia?.fileUrl || primaryMedia?.url;
        const mediaType = primaryMedia?.type || 'image';
        
        return `
            <div class="workflow-card" style="
                position: relative;
                display: flex;
                flex-direction: column;
                gap: 0;
                padding: 0;
                border-radius: 18px;
                background: #050505;
                border: 1px solid rgba(255,255,255,0.08);
                box-shadow: 0 10px 35px rgba(0,0,0,0.55);
                min-height: 260px;
                overflow: hidden;
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
                ${baseStyle} ${disabledStyle}
            " 
              ${!isPreview ? `onclick="document.getElementById('workflow-${workflow.id}').click();"` : ''}
              onmouseover="this.style.boxShadow='0 18px 40px rgba(0,0,0,0.7)'; nitraPlayWorkflowVideo('${workflow.id}');"
              onmouseout="this.style.boxShadow='0 10px 35px rgba(0,0,0,0.55)'; nitraPauseWorkflowVideo('${workflow.id}');"
            >
                <div style="position:absolute; inset:0; overflow:hidden;">
                    ${mediaUrl ? (
                        mediaType === 'video'
                            ? `<video id="nitra-workflow-video-${workflow.id}" src="${mediaUrl}" muted playsinline loop style="width:100%;height:100%;object-fit:cover;"></video>`
                            : `<img src="${mediaUrl}" alt="Workflow preview" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
                    ) : `
                        <div style="width:100%;height:100%;background:radial-gradient(circle at 0 0,#1f2937,transparent 50%), radial-gradient(circle at 100% 100%,#111827,transparent 55%), #000000;"></div>
                    `}
                </div>
                <div style="position:relative; z-index:1; display:flex; flex-direction:column; justify-content:space-between; height:100%; padding:16px 16px 14px 16px;">
                    <div style="display:flex; align-items:flex-start; justify-content:flex-start; gap:10px;">
                        <label style="display:flex; align-items:center; gap:10px; color:#f9fafb; font-weight:600; cursor:pointer;">
                            <input type="checkbox" id="workflow-${workflow.id}" value="${workflow.id}" ${isPreview ? 'disabled' : 'onclick="event.stopPropagation();"'} style="transform:scale(1.15);">
                            <span style="text-shadow:0 2px 4px rgba(0,0,0,0.9);">${workflow.name || 'Unnamed Workflow'}${lockIcon}</span>
                        </label>
                    </div>
                    <div style="margin-top:auto;">
                        <div style="font-size: 0.9em; color: #f9fafb; opacity: 0.92; line-height: 1.6; text-shadow:0 1px 3px rgba(0,0,0,0.9);">
                    ${workflow.description || 'No description available'}
                </div>
                ${workflow.tags && workflow.tags.length > 0 ? `
                            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                                ${workflow.tags.map(tag => `<span style="background: rgba(0,0,0,0.65); color: #f9fafb; padding: 2px 10px; border-radius: 999px; font-size: 0.75em; letter-spacing:0.08em; text-transform:uppercase; border:1px solid rgba(249,250,251,0.25);">${tag}</span>`).join('')}
                            </div>
                        ` : ''}
                        ${isPreview ? `<div style="font-size: 0.8em; color: #fbbf24; font-weight: 600; margin-top:6px; text-shadow:0 1px 3px rgba(0,0,0,0.9);">Subscribe to download</div>` : ''}
                    </div>
            </div>
        </div>
        `;
    }).join('');
    
    // Update upgrade banner area (above gallery)
    const upgradeContainer = document.getElementById('nitra-workflows-upgrade');
    if (upgradeContainer) {
    if (inPreviewMode) {
            upgradeContainer.innerHTML = `
                <div style="
                    background: linear-gradient(135deg, rgba(160, 187, 196, 0.08), rgba(209, 78, 114, 0.12));
                    border: 1px solid rgba(160, 187, 196, 0.35);
                    border-radius: 10px;
                    padding: 14px 16px;
                    margin-bottom: 16px;
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    gap:12px;
                ">
                    <div style="color:#f9fafb; font-size:13px;">
                        <div style="font-weight:600; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">
                            Unlock Full Workflow Downloads
                        </div>
                        <div style="opacity:0.9;">
                            You can preview every workflow here. Activate your Nitra subscription to download and install them directly into ComfyUI.
            </div>
            </div>
            <button onclick="window.open('${getWebsiteBaseUrl()}/#pricing', '_blank')" 
                        style="white-space:nowrap; background:#0b0b0b; color:#ffffff; border:1px solid #ffffff; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:600; font-size:13px;">
                        View Plans
            </button>
                </div>
        `;
        } else {
            upgradeContainer.innerHTML = '';
        }
    }
    
    // Add event listeners to checkboxes (only for non-preview items)
    filteredWorkflows.forEach(workflow => {
        const checkbox = document.getElementById(`workflow-${workflow.id}`);
        if (checkbox && !workflow._previewMode) {
            checkbox.checked = state.selectedWorkflows.has(workflow.id);
            checkbox.onchange = () => {
                if (checkbox.checked) {
                    state.selectedWorkflows.add(workflow.id);
                } else {
                    state.selectedWorkflows.delete(workflow.id);
                }
                updateWorkflowInstallButton();
            };
        }
    });
    
    // Add search functionality
    const searchInput = document.getElementById('nitra-workflow-search');
    if (searchInput) {
        searchInput.oninput = () => {
            renderWorkflows();
            updateWorkflowInstallButton();
        };
    }
    
    // Add select all functionality
    const selectAllWorkflowsBtn = document.getElementById('nitra-select-all-workflows');
    if (selectAllWorkflowsBtn) {
        selectAllWorkflowsBtn.onclick = () => {
            filteredWorkflows
                .filter(workflow => !workflow._previewMode)
                .forEach(workflow => state.selectedWorkflows.add(workflow.id));
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










