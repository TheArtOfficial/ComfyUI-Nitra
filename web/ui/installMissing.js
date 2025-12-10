import * as state from '../core/state.js';
import { div, button, input, label, span } from './components/core.js';
import { ListItem } from './components/ListItem.js';
import { getCurrentWorkflowDependencies } from '../workflows/analyzer.js';
import { matchCustomNodes, matchModels } from '../core/matcher.js';
import { fetchCustomNodesLibrary, fetchNodeMappings, fetchInstalledCustomNodes } from '../customNodes/api.js';
import { getExistingModels } from '../workflows/api.js';
import { showHuggingFaceTokenPrompt, showRestartPrompt } from './systemPrompts.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { app } from "/scripts/app.js";

// Track selections
const selectedInstallItems = {
    nodes: new Set(),
    models: new Set()
};

let matchedModelsCache = [];
let installationInProgress = false;
let abortController = null;
let statusPollInterval = null;
let installedMismatchedModels = []; // Track models installed with different names

/**
 * Find and replace model names in the LIVE ComfyUI graph
 * This modifies the actual graph displayed in the UI
 * @param {string} oldPath - The exact old path to find (e.g., "WAN\model.safetensors")
 * @param {string} newName - The new model name to replace with
 * @returns {number} - Number of replacements made
 */
function replaceModelInLiveGraph(oldPath, newName) {
    let replacements = 0;
    const modelExtensions = ['.safetensors', '.ckpt', '.pt', '.bin', '.pth', '.gguf'];
    
    if (!app?.graph?._nodes) {
        console.warn('No live graph available');
        return 0;
    }
    
    // Extract just the filename from oldPath for flexible matching
    const oldFilename = oldPath.split(/[/\\]/).pop();
    
    console.log(`Looking for exact: "${oldPath}" OR filename: "${oldFilename}"`);
    
    // Helper to check if a value matches what we're looking for
    const isMatch = (val) => {
        if (typeof val !== 'string') return false;
        const valFilename = val.split(/[/\\]/).pop();
        return val === oldPath || valFilename === oldFilename || val === oldFilename;
    };
    
    // Helper to recursively search and replace in objects/arrays
    const searchAndReplaceInObject = (obj, path = '') => {
        if (obj === null || obj === undefined) return 0;
        let count = 0;
        
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (isMatch(obj[i])) {
                    console.log(`  Found in ${path}[${i}]: "${obj[i]}" -> "${newName}"`);
                    obj[i] = newName;
                    count++;
                } else if (typeof obj[i] === 'object') {
                    count += searchAndReplaceInObject(obj[i], `${path}[${i}]`);
                }
            }
        } else if (typeof obj === 'object') {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (isMatch(obj[key])) {
                        console.log(`  Found in ${path}.${key}: "${obj[key]}" -> "${newName}"`);
                        obj[key] = newName;
                        count++;
                    } else if (typeof obj[key] === 'object') {
                        count += searchAndReplaceInObject(obj[key], `${path}.${key}`);
                    }
                }
            }
        }
        return count;
    };
    
    // Iterate through all nodes in the live graph
    for (const node of app.graph._nodes) {
        const nodeLabel = node.title || node.type;
        
        // Check widgets
        if (node.widgets) {
            for (const widget of node.widgets) {
                const val = widget.value;
                
                // Check if this looks like a model file (for logging)
                if (typeof val === 'string') {
                    const valLower = val.toLowerCase();
                    const isModelWidget = modelExtensions.some(ext => valLower.endsWith(ext));
                    if (isModelWidget) {
                        console.log(`  Node "${nodeLabel}" widget "${widget.name}" = "${val}"`);
                    }
                }
                
                // Check string values
                if (isMatch(val)) {
                    console.log(`  MATCH in widget! Node "${nodeLabel}" widget "${widget.name}": "${val}" -> "${newName}"`);
                    widget.value = newName;
                    replacements++;
                    
                    if (widget.callback) {
                        try {
                            widget.callback(newName, app.canvas, node, [0, 0], null);
                        } catch (e) {}
                    }
                }
                // Check object/array widget values (like LoRA configs)
                else if (typeof val === 'object' && val !== null) {
                    const count = searchAndReplaceInObject(val, `${nodeLabel}.widget.${widget.name}`);
                    replacements += count;
                }
            }
        }
        
        // Check widgets_values array
        if (node.widgets_values) {
            const count = searchAndReplaceInObject(node.widgets_values, `${nodeLabel}.widgets_values`);
            replacements += count;
        }
        
        // Check properties (some nodes store configs here)
        if (node.properties) {
            const count = searchAndReplaceInObject(node.properties, `${nodeLabel}.properties`);
            replacements += count;
        }
    }
    
    // Mark graph as changed so it gets saved
    if (replacements > 0 && app.graph) {
        app.graph.change();
    }
    
    return replacements;
}

/**
 * Find and replace model path in a workflow JSON object (for localStorage backup)
 * @param {object} workflow - The workflow JSON object
 * @param {string} oldPath - The exact old path to find (e.g., "WAN\model.safetensors")
 * @param {string} newName - The new model name to replace with (just filename, no folder)
 * @returns {number} - Number of replacements made
 */
function replaceModelNameInWorkflow(workflow, oldPath, newName) {
    let replacements = 0;
    
    function searchAndReplace(obj) {
        if (obj === null || obj === undefined) return;
        
        if (typeof obj === 'string') {
            return; // Strings are immutable, handled at parent level
        }
        
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (typeof obj[i] === 'string' && obj[i] === oldPath) {
                    // Replace with just the new filename (no folder path needed for installed models)
                    obj[i] = newName;
                    replacements++;
                } else if (typeof obj[i] === 'object') {
                    searchAndReplace(obj[i]);
                }
            }
            return;
        }
        
        if (typeof obj === 'object') {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (typeof obj[key] === 'string' && obj[key] === oldPath) {
                        // Replace with just the new filename (no folder path needed for installed models)
                        obj[key] = newName;
                        replacements++;
                    } else if (typeof obj[key] === 'object') {
                        searchAndReplace(obj[key]);
                    }
                }
            }
        }
    }
    
    searchAndReplace(workflow);
    return replacements;
}

/**
 * Fix mismatched model names in the current workflow
 * @param {Array} mismatchedModels - Array of {detectedName, installedName} objects
 * @returns {object} - {success, fixedCount, errors}
 */
/**
 * Find all model-like string values in the workflow for debugging
 */
function findAllModelValuesInWorkflow(workflow) {
    const modelExtensions = ['.safetensors', '.ckpt', '.pt', '.bin', '.pth', '.gguf'];
    const foundValues = [];
    
    function scan(obj, path = '') {
        if (obj === null || obj === undefined) return;
        
        if (typeof obj === 'string') {
            const valLower = obj.toLowerCase();
            if (modelExtensions.some(ext => valLower.endsWith(ext))) {
                foundValues.push({ path, value: obj });
            }
            return;
        }
        
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => scan(item, `${path}[${i}]`));
            return;
        }
        
        if (typeof obj === 'object') {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    scan(obj[key], path ? `${path}.${key}` : key);
                }
            }
        }
    }
    
    scan(workflow);
    return foundValues;
}

function fixWorkflowModelNames(mismatchedModels) {
    try {
        console.log('=== FIX MODEL NAMES START ===');
        console.log('Mismatched models to fix:', mismatchedModels);
        
        let totalFixed = 0;
        const errors = [];
        
        // STEP 1: Fix the LIVE graph (immediate visual update)
        console.log('\n--- Fixing live graph ---');
        for (const model of mismatchedModels) {
            const searchPath = model.originalPath || model.detectedName;
            
            console.log(`\nSearching for: "${searchPath}"`);
            console.log(`  (detected filename: "${model.detectedName}")`);
            console.log(`Will replace with: "${model.installedName}"`);
            
            try {
                const liveCount = replaceModelInLiveGraph(searchPath, model.installedName);
                totalFixed += liveCount;
                console.log(`Fixed ${liveCount} in live graph`);
            } catch (e) {
                errors.push(`Failed to replace ${model.detectedName} in live graph: ${e.message}`);
                console.error(`Error replacing in live graph:`, e);
            }
        }
        
        // STEP 2: Also update localStorage for persistence
        console.log('\n--- Updating localStorage ---');
        const workflowStr = localStorage.getItem('workflow');
        if (workflowStr) {
            try {
                const workflow = JSON.parse(workflowStr);
                let localStorageFixed = 0;
                
                for (const model of mismatchedModels) {
                    const searchPath = model.originalPath || model.detectedName;
                    const count = replaceModelNameInWorkflow(workflow, searchPath, model.installedName);
                    localStorageFixed += count;
                }
                
                if (localStorageFixed > 0) {
                    localStorage.setItem('workflow', JSON.stringify(workflow));
                    console.log(`Updated ${localStorageFixed} in localStorage`);
                }
            } catch (e) {
                console.warn('Could not update localStorage:', e);
            }
        }
        
        console.log(`\nTotal fixes: ${totalFixed}`);
        
        if (totalFixed === 0) {
            console.log('No fixes made - model names not found in workflow');
        }
        
        console.log('=== FIX MODEL NAMES END ===');
        return { success: true, fixedCount: totalFixed, errors };
    } catch (e) {
        console.error('Error in fixWorkflowModelNames:', e);
        return { success: false, fixedCount: 0, errors: [e.message] };
    }
}

/**
 * Show a dialog to fix mismatched model names
 */
function showFixModelNamesDialog(mismatchedModels, onComplete) {
    // Create overlay
    const overlay = div({
        style: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
        }
    });
    
    const dialog = div({
        style: {
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            color: '#fff'
        }
    });
    
    const title = div({
        style: {
            fontSize: '1.3em',
            fontWeight: 'bold',
            marginBottom: '16px'
        }
    }, 'Fix Model Names in Workflow?');
    
    const description = div({
        style: {
            marginBottom: '16px',
            lineHeight: '1.5',
            color: '#ccc'
        }
    }, `Found ${mismatchedModels.length} model(s) with different names than what was installed. Would you like to update the workflow to use the correct model names?`);
    
    const modelList = div({
        style: {
            backgroundColor: '#0a0a0a',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            maxHeight: '200px',
            overflowY: 'auto',
            fontSize: '0.85em'
        }
    });
    
    mismatchedModels.forEach(m => {
        const item = div({
            style: {
                marginBottom: '8px',
                paddingBottom: '8px',
                borderBottom: '1px solid #222'
            }
        });
        // Show the original path (what's in the workflow) and what it will be changed to
        const displayPath = m.originalPath || m.detectedName;
        item.innerHTML = `
            <div style="color: #ef4444; word-break: break-all;">From: ${displayPath}</div>
            <div style="color: #22c55e;">To: ${m.installedName}</div>
        `;
        modelList.appendChild(item);
    });
    
    const buttonContainer = div({
        style: {
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end'
        }
    });
    
    const skipBtn = button({
        className: 'nitra-btn',
        style: {
            padding: '10px 20px'
        },
        onclick: () => {
            document.body.removeChild(overlay);
            if (onComplete) onComplete(false);
        }
    }, 'Skip');
    
    const fixBtn = button({
        className: 'nitra-btn nitra-btn-primary',
        style: {
            padding: '10px 20px',
            backgroundColor: '#22c55e',
            border: '1px solid #22c55e'
        },
        onclick: () => {
            const result = fixWorkflowModelNames(mismatchedModels);
            document.body.removeChild(overlay);
            
            // Log result to console, no alert - just close dialog so user can see the workflow
            if (result.fixedCount > 0) {
                console.log(`Fixed ${result.fixedCount} model reference(s) in the workflow`);
            } else {
                console.log('No model references were fixed');
            }
            
            if (onComplete) onComplete(true);
        }
    }, 'Fix Model Names');
    
    buttonContainer.appendChild(skipBtn);
    buttonContainer.appendChild(fixBtn);
    
    dialog.appendChild(title);
    dialog.appendChild(description);
    dialog.appendChild(modelList);
    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);
    
    document.body.appendChild(overlay);
}

export async function renderInstallMissing(container) {
    try {
        // Show initial landing screen
        showLandingScreen(container);
    } catch (err) {
        console.error("Nitra: Critical error in renderInstallMissing:", err);
        container.innerHTML = `<div style="padding:20px; color:red;">Error loading tab: ${err.message}</div>`;
    }
}

function showLandingScreen(container) {
    container.innerHTML = '';
    container.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden;';

    // Centered content wrapper
    const wrapper = div({
        style: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '40px 20px',
            textAlign: 'center'
        }
    });

    // Info section
    const infoSection = div({
        style: {
            maxWidth: '700px',
            marginBottom: '50px'
        }
    });

    const infoTitle = div({
        style: {
            color: '#fff',
            fontSize: '2.5em',
            fontWeight: '700',
            marginBottom: '24px'
        }
    }, 'Install Missing Dependencies');

    const infoText = div({
        style: {
            color: '#e5e7eb',
            fontSize: '1.3em',
            lineHeight: '1.7'
        }
    });
    infoText.innerHTML = `
        This tool analyzes your currently open workflow to identify all custom nodes and models it requires.<br><br>
        It then attempts to match them against the Nitra library and download them straight into your environment. 
    `;

    infoSection.appendChild(infoTitle);
    infoSection.appendChild(infoText);
    wrapper.appendChild(infoSection);

    // Check subscription status
    const hasSubscription = state.currentLicenseStatus && 
        (state.currentLicenseStatus.has_paid_subscription || state.currentLicenseStatus.status === 'paid');

    // Common button styles (white button, black outline, white glow)
    const glowButtonStyle = `
        padding: 18px 48px !important;
        font-size: 1.2em !important;
        font-weight: 600 !important;
        background: #ffffff !important;
        color: #000000 !important;
        border: 2px solid #000000 !important;
        border-radius: 12px !important;
        cursor: pointer !important;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.5), 0 0 40px rgba(255, 255, 255, 0.3) !important;
        animation: button-glow-pulse 2.5s ease-in-out infinite !important;
    `;

    if (hasSubscription) {
        // Large glowing "Find Missing" button for subscribed users
        const findBtn = button({
            className: 'nitra-btn',
            onclick: () => {
                startDependencyAnalysis(container);
            }
        }, 'Find Missing');
        findBtn.style.cssText = glowButtonStyle;
        wrapper.appendChild(findBtn);
    } else {
        // Subscribe button for non-subscribed users
        const subscribeBtn = button({
            className: 'nitra-btn',
            onclick: () => {
                const baseUrl = getWebsiteBaseUrl();
                window.open(baseUrl ? `${baseUrl}/#pricing` : '/#pricing', '_blank');
            }
        });
        subscribeBtn.style.cssText = glowButtonStyle + `
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
        `;
        // Lock icon (Unicode)
        const lockIcon = span({
            style: {
                fontSize: '1.1em'
            }
        }, '\u{1F512}');
        subscribeBtn.appendChild(lockIcon);
        subscribeBtn.appendChild(document.createTextNode(' Subscribe'));
        wrapper.appendChild(subscribeBtn);
    }

    container.appendChild(wrapper);
}

async function startDependencyAnalysis(container) {
    try {
        // reset selections each render
        selectedInstallItems.nodes.clear();
        selectedInstallItems.models.clear();
        matchedModelsCache = [];

        container.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 100%; width: 100%;"><div style="color: #ffffff; text-align: center; font-size: 2.2em; font-weight: 600;">Analyzing Workflow...</div></div>';

        // 1) Gather data
        const { customNodes, cnrIds, auxIds, models } = getCurrentWorkflowDependencies();

        const availableNodes = await fetchCustomNodesLibrary();

        // Fetch mappings to resolve specific node types to packs
        const nodeMappings = await fetchNodeMappings();

        const availableModels = state.modelsData || [];

        const installedModelIds = await getExistingModels();

        // Get currently installed node types to check against
        const installedNodeTypes = new Set(Object.values(LiteGraph.registered_node_types || {}).map(t => t.type));

        // Get installed custom node folder names
        const installedNodeFolders = await fetchInstalledCustomNodes();

        const nodeResults = matchCustomNodes(customNodes, cnrIds, auxIds, availableNodes, installedNodeTypes, nodeMappings, installedNodeFolders);

        const modelResults = matchModels(models, availableModels, installedModelIds);

        matchedModelsCache = modelResults.matches;

        // 2) Build layout
        container.innerHTML = '';
        container.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden;';

        // Info header explaining what this tab does
        const infoHeader = div({
            style: {
                margin: '12px 20px',
                padding: '12px 16px',
                background: '#121212',
                border: '1px solid #ffffff',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '0.9em',
                lineHeight: '1.5'
            }
        });
        infoHeader.innerHTML = `
            <strong style="font-size: 1em;">Install Missing Dependencies</strong> - 
            Select the custom nodes and models you want to install. Items already installed are shown as disabled.<br><br>

            If a model shows less than 100% match, use the <strong style="color: #22c55e;">Fix Model Names</strong> button to automatically update the workflow with the correct model filenames.<br>
            If a model does not have a match, it likely auto-downloads during the workflow run.
            
            <div style="color: #ef4444 !important; margin-top: 8px; font-size: 0.85em; font-weight: bold;">
                Installing Custom Nodes that do not come with the official Nitra Workflows can lead to mismatched software requirements, and break your ComfyUI install. Install with caution.
            </div>
        `;
        container.appendChild(infoHeader);

    // Store matched results for Select All/Deselect All
    let matchedNodes = [];
    let matchedModelsList = [];

    // Toolbar with Select All / Deselect All buttons
    const toolbar = div({
        style: {
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.05)'
        }
    });

    const selectAllBtn = button({
        className: 'nitra-btn',
        style: {
            padding: '10px 16px',
            background: 'transparent',
            border: '1px solid #ffffff',
            borderRadius: '8px',
            color: '#ffffff',
            fontSize: '0.85em',
            fontWeight: '600',
            cursor: 'pointer'
        },
        onmouseover: function() { this.style.opacity = '0.85'; this.style.background = 'rgba(255,255,255,0.1)'; },
        onmouseout: function() { this.style.opacity = '1'; this.style.background = 'transparent'; },
        onclick: () => {
            // Select all non-installed items
            matchedNodes.forEach(item => {
                if (!item.isInstalled) {
                    selectedInstallItems.nodes.add(item.id);
                    const checkbox = document.getElementById(`item-nodes-${item.id}`);
                    if (checkbox) checkbox.checked = true;
                }
            });
            matchedModelsList.forEach(item => {
                if (!item.isInstalled) {
                    selectedInstallItems.models.add(item.id);
                    const checkbox = document.getElementById(`item-models-${item.id}`);
                    if (checkbox) checkbox.checked = true;
                }
            });
            updateInstallButton();
            updateTokenVisibility();
        }
    }, '\u2713 Select All');

    const deselectAllBtn = button({
        className: 'nitra-btn',
        style: {
            padding: '10px 16px',
            background: 'transparent',
            border: '1px solid #ffffff',
            borderRadius: '8px',
            color: '#ffffff',
            fontSize: '0.85em',
            fontWeight: '600',
            cursor: 'pointer'
        },
        onmouseover: function() { this.style.opacity = '0.85'; this.style.background = 'rgba(255,255,255,0.1)'; },
        onmouseout: function() { this.style.opacity = '1'; this.style.background = 'transparent'; },
        onclick: () => {
            // Deselect all items
            selectedInstallItems.nodes.clear();
            selectedInstallItems.models.clear();
            matchedNodes.forEach(item => {
                if (!item.isInstalled) {
                    const checkbox = document.getElementById(`item-nodes-${item.id}`);
                    if (checkbox) checkbox.checked = false;
                }
            });
            matchedModelsList.forEach(item => {
                if (!item.isInstalled) {
                    const checkbox = document.getElementById(`item-models-${item.id}`);
                    if (checkbox) checkbox.checked = false;
                }
            });
            updateInstallButton();
            updateTokenVisibility();
        }
    }, '\u2715 Deselect All');

    toolbar.appendChild(selectAllBtn);
    toolbar.appendChild(deselectAllBtn);
    container.appendChild(toolbar);

    const contentArea = div({
        style: {
            display: 'flex',
            flex: 1,
            overflow: 'hidden',
            gap: '20px',
            padding: '20px'
        }
    });

    const createColumn = (title, items, type, unmatchedItems = []) => {
        const totalCount = items.length + unmatchedItems.length;
        const col = div({
            style: {
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)',
                overflow: 'hidden'
            }
        });

        col.appendChild(div({
            style: {
                padding: '16px',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                fontWeight: '600',
                color: '#fff',
                background: 'rgba(0,0,0,0.2)'
            }
        }, `${title} (${totalCount})`));

        const listContainer = div({
            style: {
                flex: 1,
                overflowY: 'auto',
                padding: '8px'
            }
        });

        if (totalCount === 0) {
            listContainer.appendChild(div({
                style: { padding: '20px', textAlign: 'center', color: '#666' }
            }, "None detected"));
        } else {
            // Render matched items first
            items.forEach(item => {
                const isInstalled = item.isInstalled;

                // Default select missing items
                if (!isInstalled) {
                    type === 'nodes' ? selectedInstallItems.nodes.add(item.id) : selectedInstallItems.models.add(item.id);
                }

                // Format display text per user request: Big Name + % Match
                let rightText = '';
                if (type === 'nodes') {
                     // Custom nodes matched by ID are 100% matches
                     rightText = isInstalled ? 'Installed' : '100%';
                } else {
                     // Models
                     if (isInstalled) {
                         rightText = 'Installed';
                     } else {
                         const score = item.score !== undefined ? item.score : 1.0;
                         rightText = `${Math.round(score * 100)}%`;
                     }
                     
                     if (item.hfTokenRequired) {
                        rightText += ' 🔒';
                     }
                }

                // Get original detected name and matched name
                const matchedName = item.name || item.modelName;
                const originalName = item.detectedName || matchedName;
                const score = item.score !== undefined ? item.score : 1.0;
                const isExactMatch = score >= 1.0;

                // Only show original/matched labels for fuzzy matches (not 100%)
                let title = matchedName;
                let description = null;
                if (!isExactMatch && originalName && originalName !== matchedName) {
                    title = `Matched: ${matchedName}`;
                    description = `Original: ${originalName}`;
                }

                const li = ListItem({
                    id: `${type}-${item.id}`,
                    title: title,
                    description: description,
                    meta: null,
                    rightContent: rightText,
                    checked: !isInstalled, // Checked by default if missing
                    disabled: isInstalled, // Disable if already installed
                    onChange: (checked) => {
                        if (isInstalled) return;
                        if (checked) {
                            type === 'nodes' ? selectedInstallItems.nodes.add(item.id) : selectedInstallItems.models.add(item.id);
                        } else {
                            type === 'nodes' ? selectedInstallItems.nodes.delete(item.id) : selectedInstallItems.models.delete(item.id);
                        }
                        updateInstallButton();
                        updateTokenVisibility();
                    }
                });
                listContainer.appendChild(li);
            });

            // Render unmatched items - red if not installed, grayed out if installed locally
            unmatchedItems.forEach(item => {
                const isInstalled = item.isInstalled === true;
                
                const unmatchedRow = div({
                    style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        background: isInstalled ? 'rgba(255,255,255,0.02)' : 'rgba(239, 68, 68, 0.1)',
                        borderLeft: isInstalled ? '3px solid #666' : '3px solid #ef4444',
                        overflow: 'hidden',
                        opacity: isInstalled ? 0.6 : 1
                    }
                });

                const nameEl = div({
                    style: {
                        color: isInstalled ? '#999' : '#ef4444',
                        fontSize: '0.9em',
                        fontWeight: '600',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }
                }, item.name);

                const statusLabel = div({
                    style: {
                        color: isInstalled ? '#666' : '#ef4444',
                        fontSize: '0.8em',
                        fontWeight: '600',
                        marginLeft: '10px',
                        flexShrink: 0
                    }
                }, isInstalled ? 'Installed (not in library)' : 'Not Found');

                unmatchedRow.appendChild(nameEl);
                unmatchedRow.appendChild(statusLabel);
                listContainer.appendChild(unmatchedRow);
            });
        }

        col.appendChild(listContainer);
        return col;
    };

    // Store references for Select All / Deselect All buttons
    // Filter to only show missing (not installed) custom nodes
    matchedNodes = nodeResults.matches.filter(n => !n.isInstalled);
    matchedModelsList = modelResults.matches;

    // For custom nodes, only show missing packages (not installed ones)
    contentArea.appendChild(createColumn("Missing Custom Nodes", matchedNodes, 'nodes'));
    // For models, show both matched and unmatched
    contentArea.appendChild(createColumn("Models", modelResults.matches, 'models', modelResults.missing));
    container.appendChild(contentArea);

    // 3) Footer with HF token
    const footer = div({
        style: {
            padding: '20px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            background: '#0b0b0b',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        }
    });

    const hfTokenContainer = div({
        id: 'nitra-install-missing-hf-container',
        style: {
            display: 'none',
            padding: '12px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            marginBottom: '8px'
        }
    });

    const tokenInput = input({
        type: 'password',
        placeholder: 'hf_...',
        className: 'nitra-input',
        style: { width: '100%', marginTop: '8px' }
    });

    // Prefill token from user-config
    fetch('/nitra/user-config')
        .then(r => r.ok ? r.json() : null)
        .then(cfg => {
            if (cfg?.huggingface_token) tokenInput.value = cfg.huggingface_token;
        })
        .catch(() => {});

    hfTokenContainer.appendChild(div({
        style: { fontSize: '0.9em', color: '#e5e7eb', marginBottom: '4px' }
    }, 'Some selected models require a Hugging Face Access Token.'));
    hfTokenContainer.appendChild(tokenInput);
    footer.appendChild(hfTokenContainer);

    const actionRow = div({
        style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }
    });

    // Check for mismatched model names (detected != matched)
    // Use originalPath (the actual string in the workflow) for searching
    const getMismatchedModels = () => matchedModelsCache
        .filter(m => m.detectedName && m.modelName && m.detectedName !== m.modelName)
        .map(m => ({
            detectedName: m.detectedName,           // stripped filename (for UI display)
            originalPath: m.originalPath || m.detectedName,  // actual string in workflow (for search/replace)
            installedName: m.modelName              // what we want to replace it with
        }));

    const fixModelNamesBtn = button({
        className: 'nitra-btn',
        style: { 
            padding: '12px 24px', 
            fontSize: '1.1em',
            display: 'none',
            background: 'rgba(34, 197, 94, 0.2)',
            border: '1px solid rgba(34, 197, 94, 0.5)',
            color: '#22c55e'
        },
        onclick: () => {
            const mismatched = getMismatchedModels();
            if (mismatched.length > 0) {
                showFixModelNamesDialog(mismatched, () => {});
            }
        }
    }, "Fix Model Names");

    // Show fix button if there are mismatched models
    const updateFixButtonVisibility = () => {
        const mismatched = getMismatchedModels();
        fixModelNamesBtn.style.display = mismatched.length > 0 ? 'inline-block' : 'none';
    };
    updateFixButtonVisibility();

    const cancelBtn = button({
        className: 'nitra-btn',
        style: { 
            padding: '12px 24px', 
            fontSize: '1.1em',
            display: 'none',
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            color: '#ef4444'
        },
        onclick: () => handleCancel()
    }, "Cancel Install");

    const installBtn = button({
        className: 'nitra-btn nitra-btn-primary',
        style: { padding: '12px 24px', fontSize: '1.1em' },
        onclick: () => handleInstall()
    }, "Install Selected");

    actionRow.appendChild(fixModelNamesBtn);
    actionRow.appendChild(cancelBtn);
    actionRow.appendChild(installBtn);
    footer.appendChild(actionRow);
    container.appendChild(footer);

    // Helpers
    const updateTokenVisibility = () => {
        const selectedModelIds = selectedInstallItems.models;
        const needsToken = matchedModelsCache.some(m => selectedModelIds.has(m.id) && m.hfTokenRequired);
        hfTokenContainer.style.display = needsToken ? 'block' : 'none';
        return needsToken;
    };

    const resetUiState = () => {
        installationInProgress = false;
        cancelBtn.style.display = 'none';
        installBtn.textContent = "Install Selected";
        installBtn.disabled = false;
        installBtn.style.opacity = '1';
        updateInstallButton();
    };

    const updateInstallButton = () => {
        const count = selectedInstallItems.nodes.size + selectedInstallItems.models.size;

        // If an install is in progress, keep the button in "running" state
        if (installationInProgress) {
            installBtn.disabled = true;
            installBtn.style.opacity = '0.6';
            return;
        }

        installBtn.textContent = `Install Selected (${count})`;
        installBtn.disabled = count === 0;
        installBtn.style.opacity = count === 0 ? '0.5' : '1';
    };

    const handleCancel = async () => {
        if (!installationInProgress) return;
        
        try {
            // Abort the fetch request if possible
            if (abortController) {
                abortController.abort();
            }
            
            // Call cancel endpoint to stop the running script
            await fetch('/nitra/execute/cancel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.currentUser?.apiToken || ''}`
                },
                body: JSON.stringify({
                    user_email: state.currentUser?.email
                })
            });
            
            resetUiState();
        } catch (e) {
            console.error("Cancel error:", e);
            // Reset UI even if cancel fails
            resetUiState();
        }
    };

    const startStatusPolling = () => {
        // Clear any prior poller
        if (statusPollInterval) {
            clearInterval(statusPollInterval);
        }
        // Poll backend update status every 2s; stop on completion/failure/cancel
        statusPollInterval = setInterval(async () => {
            try {
                const resp = await fetch(`/nitra/status/update?userEmail=${encodeURIComponent(state.currentUser?.email || '')}`, {
                    headers: { 'Authorization': `Bearer ${state.currentUser?.apiToken || ''}` }
                });
                if (!resp.ok) return;
                const data = await resp.json();
                const status = data?.status || data?.state || '';
                const done = ['completed', 'failed', 'cancelled', 'canceled'].includes(status);
                if (done) {
                    clearInterval(statusPollInterval);
                    statusPollInterval = null;
                    resetUiState();
                    
                    // Show restart prompt only on successful completion
                    if (status === 'completed') {
                        // Check if there are mismatched model names to fix
                        if (installedMismatchedModels.length > 0) {
                            showFixModelNamesDialog(installedMismatchedModels, (fixed) => {
                                // Clear the list after handling
                                installedMismatchedModels = [];
                                // If they didn't fix (and page didn't reload), show restart prompt
                                if (!fixed) {
                                    showRestartPrompt({
                                        onRestartSuccess: () => state.setPendingRefreshAfterRestart(true),
                                    });
                                }
                            });
                        } else {
                            showRestartPrompt({
                                onRestartSuccess: () => state.setPendingRefreshAfterRestart(true),
                            });
                        }
                    }
                }
            } catch (err) {
                // Ignore transient polling errors
            }
        }, 2000);
    };

    const handleInstall = async () => {
        if (installBtn.disabled || installationInProgress) return;

        const needsToken = updateTokenVisibility();
        const tokenValue = tokenInput.value.trim();
        if (needsToken && !tokenValue) {
            showHuggingFaceTokenPrompt({ context: 'model' });
            return;
        }

        try {
            installationInProgress = true;
            abortController = new AbortController();
            
            // Show cancel button, update install button
            cancelBtn.style.display = 'inline-block';
            installBtn.textContent = "Installing...";
            installBtn.disabled = true;
            installBtn.style.opacity = '0.5';
            // Track ALL models with mismatched names (detected name != matched/installed name)
            // This includes both models being installed AND already installed models
            installedMismatchedModels = matchedModelsCache
                .filter(m => m.detectedName && m.modelName && m.detectedName !== m.modelName)
                .map(m => ({
                    detectedName: m.detectedName,           // stripped filename (for UI display)
                    originalPath: m.originalPath || m.detectedName,  // actual string in workflow (for search/replace)
                    installedName: m.modelName              // what we want to replace it with
                }));
            
            console.log('Mismatched models to fix:', installedMismatchedModels);
            
            const modelsToInstall = matchedModelsCache
                .filter(m => selectedInstallItems.models.has(m.id) && !m.isInstalled)
                .map(m => ({
                    id: m.id,
                    name: m.modelName || m.name,
                    // Try multiple fields for URL; some APIs use modelUrl/fileUrl/downloadUrl
                    url: m.url || m.modelUrl || m.fileUrl || m.downloadUrl || m.href || '',
                    hf_token_required: m.hfTokenRequired,
                    installFolder: m.installFolder || 'diffusion_models'
                }));

            const nodesToInstall = nodeResults.matches
                .filter(n => selectedInstallItems.nodes.has(n.id))
                .map(n => ({
                    id: n.id,
                    name: n.name,
                    url: n.gitRepo // matcher.js now ensures this is populated from any available URL field
                }));

            const payload = {
                user_id: state.currentUser?.id,
                user_email: state.currentUser?.email,
                access_token: state.currentUser?.apiToken,
                options: {
                    workflows: [],
                    subgraphs: [],
                    models: modelsToInstall,
                    custom_nodes: nodesToInstall,
                    huggingface_token: tokenValue || undefined
                },
                script_filename: 'workflow_downloader.py'
            };

            // Use the same executor endpoint as workflows tab, with 0 workflows/subgraphs
            const response = await fetch('/nitra/execute/script', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.currentUser?.apiToken || ''}`
                },
                body: JSON.stringify(payload),
                signal: abortController.signal
            });

            if (!response.ok) throw new Error(`Request failed: ${response.status}`);

        // Installation request accepted: keep in-progress state so user can still cancel
        installationInProgress = true;
        cancelBtn.style.display = 'inline-block';
        installBtn.textContent = "Running... (use Cancel)";
        installBtn.disabled = true;
        installBtn.style.opacity = '0.6';
        updateInstallButton();
        startStatusPolling();
        return;
        } catch (e) {
        if (e.name === 'AbortError') {
            console.log("Installation request aborted by user");
        } else {
            console.error(e);
        }
        if (statusPollInterval) {
            clearInterval(statusPollInterval);
            statusPollInterval = null;
        }
        resetUiState();
        }
    };

    // initial UI state
    updateInstallButton();
    updateTokenVisibility();
    } catch (err) {
        console.error("Nitra: Critical error in startDependencyAnalysis:", err);
        container.innerHTML = `<div style="padding:20px; color:red;">Error analyzing workflow: ${err.message}</div>`;
    }
}

