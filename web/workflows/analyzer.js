import { app } from "/scripts/app.js";

// Model extensions to detect in widget values
const MODEL_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.bin', '.pth', '.gguf'];

export function getCurrentWorkflowDependencies() {
    const usedNodeTypes = new Set();
    const usedCnrIds = new Set();
    const usedAuxIds = new Set();
    // Map from stripped filename -> original path (with folder prefix if any)
    const usedModelsMap = new Map();

    // Helper to extract just the filename from a path (handles both / and \)
    const getFilename = (path) => {
        // Handle both forward and backslashes, get last segment
        const parts = path.split(/[/\\]/);
        return parts[parts.length - 1];
    };

    // Helper to recursively check if a value looks like a model filename
    const checkValue = (val, depth = 0) => {
        // Prevent infinite recursion
        if (depth > 10) return;
        
        if (typeof val === 'string') {
            const valLower = val.toLowerCase();
            if (MODEL_EXTENSIONS.some(ext => valLower.endsWith(ext))) {
                // Get both the stripped filename and keep the original path
                const filename = getFilename(val);
                // Store original path - if we've seen this filename before, keep the one with more path info
                if (!usedModelsMap.has(filename) || val.length > usedModelsMap.get(filename).length) {
                    usedModelsMap.set(filename, val);
                }
            }
        } else if (Array.isArray(val)) {
            // Recursively check array items
            val.forEach(item => checkValue(item, depth + 1));
        } else if (val && typeof val === 'object') {
            // Recursively check object values (for nested structures like lora configs)
            Object.values(val).forEach(v => checkValue(v, depth + 1));
        }
    };

    // 1. Try Local Storage "workflow" (Preferred Method)
    let processedViaLocalStorage = false;
    try {
        const workflowStr = localStorage.getItem("workflow");
        if (workflowStr) {
            const workflow = JSON.parse(workflowStr);
            console.log("Nitra: Analyzing dependencies from localStorage 'workflow'");

            // Helper to process a node definition object from JSON
            const processJsonNode = (node) => {
                if (!node) return;
                
                if (node.type) {
                    usedNodeTypes.add(node.type);
                }

                // Extract Comfy Registry ID and Aux ID if present
                if (node.properties) {
                    if (node.properties.cnr_id) {
                        usedCnrIds.add(node.properties.cnr_id);
                    }
                    if (node.properties.aux_id) {
                        usedAuxIds.add(node.properties.aux_id);
                    }
                }

                // In JSON, widget values can be an array OR an object (e.g. VHS nodes)
                if (node.widgets_values) {
                    if (Array.isArray(node.widgets_values)) {
                        node.widgets_values.forEach(val => checkValue(val));
                    } else if (typeof node.widgets_values === 'object') {
                        Object.values(node.widgets_values).forEach(val => checkValue(val));
                    }
                }
            };

            // Recursive helper to process a graph/subgraph object
            const processGraphJson = (graphObj) => {
                if (!graphObj) return;

                // Process standard nodes in this graph
                if (Array.isArray(graphObj.nodes)) {
                    graphObj.nodes.forEach(processJsonNode);
                }

                // Process Group Nodes (stored in extra.groupNodes)
                if (graphObj.extra?.groupNodes) {
                    Object.values(graphObj.extra.groupNodes).forEach(group => {
                        if (group.nodes) {
                            Object.values(group.nodes).forEach(processJsonNode);
                        }
                    });
                }
                
                // Process Subgraphs Definitions (e.g. from new frontend versions or group nodes)
                if (graphObj.definitions?.subgraphs && Array.isArray(graphObj.definitions.subgraphs)) {
                     graphObj.definitions.subgraphs.forEach(subgraph => {
                         processGraphJson(subgraph);
                     });
                }
            };

            // Start processing from the root workflow object
            processGraphJson(workflow);
            
            // Check if we actually found anything (to validate if parsing worked)
            if (usedNodeTypes.size > 0 || usedModels.size > 0) {
                 processedViaLocalStorage = true;
            }
        }
    } catch (e) {
        console.warn("Nitra: Failed to parse workflow from localStorage, falling back to app.graph", e);
    }

    // 2. Fallback to app.graph if localStorage failed or yielded nothing (Safety Net)
    if (!processedViaLocalStorage) {
        console.log("Nitra: Analyzing dependencies from app.graph");
        const graph = app.graph;
        if (graph) {
            const processGraphNode = (node) => {
                if (!node) return;

                if (node.type) {
                    usedNodeTypes.add(node.type);
                }

                // Attempt to find IDs in live object properties
                if (node.properties) {
                    if (node.properties.cnr_id) {
                        usedCnrIds.add(node.properties.cnr_id);
                    }
                    if (node.properties.aux_id) {
                        usedAuxIds.add(node.properties.aux_id);
                    }
                }

                if (Array.isArray(node.widgets)) {
                    node.widgets.forEach(widget => checkValue(widget.value));
                }

                if (Array.isArray(node.widgets_values)) {
                    node.widgets_values.forEach(val => checkValue(val));
                }
            };

            const visitedGraphs = new Set();
            const visitGraph = (currentGraph) => {
                if (!currentGraph || visitedGraphs.has(currentGraph)) return;
                visitedGraphs.add(currentGraph);

                const nodes = currentGraph.nodes || currentGraph._nodes || [];
                if (!Array.isArray(nodes)) return;

                nodes.forEach(node => {
                    processGraphNode(node);

                    if (node.isSubgraphNode?.() && node.subgraph) {
                        visitGraph(node.subgraph);
                    }

                    if (node?.type && typeof node.type === 'string' && node.type.startsWith('workflow>')) {
                        const groupId = node.type.slice(9);
                        const targetGraph = currentGraph.extra?.groupNodes ? currentGraph : app.graph;
                        const groupData = targetGraph.extra?.groupNodes?.[groupId];
                        
                        if (groupData?.nodes) {
                            Object.values(groupData.nodes).forEach(subNode => {
                                processGraphNode(subNode);
                                if (subNode.isSubgraphNode?.() && subNode.subgraph) {
                                    visitGraph(subNode.subgraph);
                                }
                            });
                        }
                    }
                });
            };

            visitGraph(graph);
        }
    }

    // Convert models map to array of objects with both filename and originalPath
    const modelsArray = Array.from(usedModelsMap.entries()).map(([filename, originalPath]) => ({
        filename,      // stripped filename for matching
        originalPath   // original value from workflow (may include folder prefix)
    }));

    return {
        customNodes: Array.from(usedNodeTypes),
        cnrIds: Array.from(usedCnrIds),
        auxIds: Array.from(usedAuxIds),
        models: modelsArray
    };
}

