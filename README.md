# ComfyUI-Nitra

Nitra is the premium automation and optimization suite for ComfyUI. It bundles curated workflow libraries, a powerful environment optimizer, CUDA and build-tool installers, and a polished account experience directly inside the ComfyUI sidebar.

## Table of Contents
- [Overview](#overview)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Quick Install](#quick-install)
  - [Manual Install](#manual-install)
- [Getting Started](#getting-started)
- [Feature Highlights](#feature-highlights)
  - [ComfyUI Optimizer](#comfyui-optimizer)
  - [Workflow Library](#workflow-library)
  - [Model Downloads](#model-downloads)
  - [User Configuration](#user-configuration)
  - [Help & Community](#help--community)
- [Troubleshooting](#troubleshooting)
- [Support](#support)

## Overview

Once installed, the Nitra panel appears in ComfyUI with an Auth0-powered sign-in. After logging in, you unlock:

- Guided environment upgrades with live hardware checks.
- A browsable gallery of cinematic workflows with video previews.
- A sortable model catalog wired into ComfyUI’s folder structure.
- Device registration, extra model path management, and contact tools—all in one place.

## Requirements

- A working ComfyUI install on Windows, Linux, or macOS.
- Python 3.10+ (matching your ComfyUI environment).
- Internet access for login, downloads, and upgrade scripts.
- Windows users: PowerShell 5.1+ and `winget` for automated installers.
- Linux/macOS users: sudo privileges for CUDA or driver updates.

## Installation

### Quick Install

```bash
cd /path/to/ComfyUI/custom_nodes
git clone https://github.com/TheArtOfficial/ComfyUI-Nitra.git
```

On Windows PowerShell:

```powershell
cd C:\path\to\ComfyUI\custom_nodes
git clone https://github.com/TheArtOfficial/ComfyUI-Nitra.git
```

Restart ComfyUI so the extension initializes.

### Manual Install

1. Download the latest ComfyUI-Nitra release archive.
2. Extract it into `ComfyUI/custom_nodes/ComfyUI-Nitra`.
3. Install Python dependencies inside your ComfyUI environment:

   ```bash
   cd ComfyUI/custom_nodes/ComfyUI-Nitra
   pip install -r requirements.txt
   ```

4. Relaunch ComfyUI.

## Getting Started

1. Open ComfyUI and click the Nitra icon in the sidebar.
2. Choose **Sign in with Nitra**, complete the Auth0 flow, and return to ComfyUI.
3. Use the left-hand navigation to switch between the Optimizer, Workflows, Models, User Configuration, and Help tabs.
4. Logout returns you to the “Welcome to Nitra” screen without launching an external browser window.

## Feature Highlights

### ComfyUI Optimizer

- **Live environment snapshot**: See your current platform, Python version, Torch build, CUDA runtime, and detected GPUs before running any upgrade.
- **One-click installers**: Launch modals for PyTorch, SageAttention, ONNX, Triton (Windows), and more via dedicated buttons.
- **Smart upgrade guidance**: PyTorch modal highlights whether the selected build already matches your system, and warns when SageAttention needs reinstalling.
- **Advanced Tools grid** (bottom of the Optimizer tab):
  - **CUDA Toolkit Manager**: Pick “latest,” “match PyTorch,” or enter a custom version. Works on Windows (via `winget`) and Linux, with nvcc path reminders after upgrades.
  - **Install Microsoft Build Tools**: Installs or reinstalls Visual Studio 2022 Build Tools with the Desktop C++ workload. Status badge turns green when detected.
  - **Open Build Tools Shell**: Launches the Visual Studio Developer PowerShell with the correct architecture (x64, x86, ARM) in a new console window.

### Workflow Library

- **Cinematic previews**: Each workflow card supports autoplaying video or image previews while you hover.
- **Search & category filters**: Narrow results by tags, categories, or free-text search, then select specific recipes to deploy.
- **Multi-select actions**: Select all, deselect all, or mix-and-match before clicking “Install Selected Workflows.”
- **Subscription cues**: Locked items display “Subscribe to download,” while active accounts can install directly from the card grid.

### Model Downloads

- **Resizable table layout**: Column widths can be dragged to fit long model names or descriptions.
- **Folder-aware filtering**: Filter by install folder (checkpoints, LORAs, etc.) to keep downloads organized.
- **Bulk queueing**: Select multiple models, optionally enter a HuggingFace token for private mirrors, and download in one click.
- **Preview gating**: Locked models show a friendly prompt to upgrade before download.

### User Configuration

- **Extra model paths**: Append additional directories that ComfyUI should scan (writes to `extra_model_paths.yaml`).
- **HuggingFace token storage**: Securely keep a token inside Nitra to speed up HF-hosted downloads.
- **Device Manager**: View machine slots, rename devices, refresh status, and register/replace the current machine with a single button.

### Help & Community

- **License status**: Sidebar badge highlights trial, active, or expired states—plus a “Purchase License” link to Nitra’s pricing page.
- **Contact form**: Send business inquiries directly from the Help tab, including name, email, phone, and company details.
- **Quick links**: Jump to GitHub issues or Nitra support resources without leaving ComfyUI.

## Troubleshooting

- **Optimizer buttons disabled**: Confirm you’re on a supported OS (Windows or Linux for CUDA/Build Tools) and that the status banner isn’t reporting an error.
- **CUDA path not updating**: After installing a toolkit, reopen the shell you use to launch ComfyUI so `nvcc` is rediscovered.
- **Models/workflows locked**: Verify your subscription status in the sidebar badge; it will prompt you to purchase if access is limited.
- **Device registration stalled**: Use the Refresh button inside User Configuration → Registered Machines, then try “Register / Replace Device” again.

## Support

- Product documentation: [https://hi.nitralabs.ai/help](https://hi.nitralabs.ai/help)
- Email: support@nitralabs.ai
- Community Discord: Available inside the Nitra sidebar under **Help → Community**

Have feedback or need a feature? Open the Nitra panel, go to **Help → Contact Support**, and include system details so we can assist quickly.

